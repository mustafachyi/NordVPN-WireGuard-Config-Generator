package store

import (
	"bytes"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"nordgen/internal/types"

	"github.com/andybalholm/brotli"
	"github.com/bytedance/sonic"
)

const (
	API_URL    = "https://api.nordvpn.com/v1/servers?limit=16384&filters[servers_technologies][identifier]=wireguard_udp"
	PUBLIC_DIR = "./public"
	REFRESH    = 5 * time.Minute
)

type State struct {
	Servers     map[string]types.ProcessedServer
	Keys        map[int]string
	RegionIndex map[string]map[string][]types.ProcessedServer
	ServerJson  []byte
	ServerEtag  string
	IndexAsset  *types.Asset
}

type Store struct {
	state    atomic.Pointer[State]
	assets   map[string]*types.Asset
	indexRaw []byte
}

var Core = &Store{
	assets: make(map[string]*types.Asset),
}

func (s *Store) Init() {
	if err := s.loadAssets(PUBLIC_DIR); err != nil {
		fmt.Printf("Asset load error: %v\n", err)
	}
	s.updateServers()
	go func() {
		ticker := time.NewTicker(REFRESH)
		for range ticker.C {
			s.updateServers()
		}
	}()
}

func (s *Store) loadAssets(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		path := filepath.Join(dir, entry.Name())
		if entry.IsDir() {
			s.loadAssets(path)
			continue
		}
		if strings.HasSuffix(entry.Name(), ".br") {
			continue
		}

		content, err := os.ReadFile(path)
		if err != nil {
			continue
		}

		relPath, _ := filepath.Rel(PUBLIC_DIR, path)
		webPath := "/" + filepath.ToSlash(relPath)

		if webPath == "/index.html" {
			s.indexRaw = content
			continue
		}

		var brContent []byte
		if _, err := os.Stat(path + ".br"); err == nil {
			brContent, _ = os.ReadFile(path + ".br")
		} else {
			var buf bytes.Buffer
			w := brotli.NewWriterLevel(&buf, brotli.BestCompression)
			w.Write(content)
			w.Close()
			brContent = buf.Bytes()
		}

		mimeType := mime.TypeByExtension(filepath.Ext(path))
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}

		s.assets[webPath] = &types.Asset{
			Content: content,
			Brotli:  brContent,
			Mime:    mimeType,
			Etag:    fmt.Sprintf(`W/"%x-%x"`, len(content), time.Now().UnixMilli()),
		}
	}
	return nil
}

func normalize(s string) string {
	b := make([]byte, 0, len(s))
	lastUnderscore := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 32
		}
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			b = append(b, c)
			lastUnderscore = false
		} else {
			if !lastUnderscore {
				b = append(b, '_')
				lastUnderscore = true
			}
		}
	}
	return string(b)
}

func validateVersion(v string) bool {
	if len(v) < 3 {
		return false
	}
	dot := -1
	for i := 0; i < len(v); i++ {
		if v[i] == '.' {
			dot = i
			break
		}
	}
	if dot == -1 {
		return false
	}

	maj := 0
	for i := 0; i < dot; i++ {
		if v[i] < '0' || v[i] > '9' {
			return false
		}
		maj = maj*10 + int(v[i]-'0')
		if maj > 999 {
			return false
		}
	}

	if maj > 2 {
		return true
	}
	if maj < 2 {
		return false
	}

	min := 0
	start := dot + 1
	if start >= len(v) {
		return false
	}

	for i := start; i < len(v); i++ {
		if v[i] == '.' {
			break
		}
		if v[i] < '0' || v[i] > '9' {
			return false
		}
		min = min*10 + int(v[i]-'0')
		if min > 999 {
			return false
		}
	}

	return min >= 1
}

func (s *Store) updateServers() {
	resp, err := http.Get(API_URL)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return
	}

	var raw []types.RawServer
	if err := sonic.Unmarshal(bodyBytes, &raw); err != nil {
		return
	}

	state := &State{
		Servers:     make(map[string]types.ProcessedServer, len(raw)),
		Keys:        make(map[int]string, len(raw)),
		RegionIndex: make(map[string]map[string][]types.ProcessedServer),
	}

	newKeys := make(map[string]int, len(raw))
	payload := types.ServerPayload{
		Headers: []string{"name", "load", "station"},
		List:    make(map[string]map[string][][]interface{}),
	}

	strPool := make(map[string]string)
	intern := func(in string) string {
		if val, ok := strPool[in]; ok {
			return val
		}
		strPool[in] = in
		return in
	}

	kID := 1

	for _, srv := range raw {
		if len(srv.Locations) == 0 {
			continue
		}

		ver := "0.0.0"
		for _, sp := range srv.Specifications {
			if sp.ID == "version" && len(sp.Values) > 0 {
				ver = sp.Values[0].Value
				break
			}
		}

		if !validateVersion(ver) {
			continue
		}

		name := normalize(srv.Name)
		if _, seen := state.Servers[name]; seen {
			continue
		}

		loc := srv.Locations[0]
		var pk string
		for _, tech := range srv.Technologies {
			for _, meta := range tech.Metadata {
				if meta.Name == "public_key" {
					pk = meta.Value
					break
				}
			}
		}

		if loc.Country.Code == "" || pk == "" {
			continue
		}

		id, exists := newKeys[pk]
		if !exists {
			id = kID
			kID++
			newKeys[pk] = id
			state.Keys[id] = pk
		}

		country := intern(normalize(loc.Country.Name))
		city := intern(normalize(loc.Country.City.Name))
		code := intern(loc.Country.Code)

		processed := types.ProcessedServer{
			Name:     name,
			Station:  srv.Station,
			Hostname: srv.Hostname,
			Country:  country,
			City:     city,
			Code:     code,
			KeyID:    id,
		}

		state.Servers[name] = processed

		if payload.List[country] == nil {
			payload.List[country] = make(map[string][][]interface{})
			state.RegionIndex[country] = make(map[string][]types.ProcessedServer)
		}

		payload.List[country][city] = append(payload.List[country][city], []interface{}{name, srv.Load, srv.Station})
		state.RegionIndex[country][city] = append(state.RegionIndex[country][city], processed)
	}

	jsonData, _ := sonic.Marshal(payload)
	state.ServerJson = jsonData
	state.ServerEtag = fmt.Sprintf(`W/"%s"`, strings.Trim(fmt.Sprintf("%x", time.Now().UnixNano()), "-"))

	s.rebuildIndex(state)
	s.state.Store(state)
}

func (s *Store) rebuildIndex(state *State) {
	if s.indexRaw == nil {
		return
	}
	script := fmt.Sprintf(`<script id="server-data" type="application/json">%s</script>`, state.ServerJson)
	htmlStr := strings.Replace(string(s.indexRaw), "</body>", script+"</body>", 1)
	content := []byte(htmlStr)

	var buf bytes.Buffer
	w := brotli.NewWriterLevel(&buf, brotli.BestCompression)
	w.Write(content)
	w.Close()

	state.IndexAsset = &types.Asset{
		Content: content,
		Brotli:  buf.Bytes(),
		Mime:    "text/html; charset=utf-8",
		Etag:    state.ServerEtag,
	}
}

func (s *Store) GetAsset(path string) *types.Asset {
	if path == "/" || path == "/index.html" {
		state := s.state.Load()
		if state == nil {
			return nil
		}
		return state.IndexAsset
	}
	return s.assets[path]
}

func (s *Store) GetServerList() ([]byte, string) {
	state := s.state.Load()
	if state == nil {
		return nil, ""
	}
	return state.ServerJson, state.ServerEtag
}

func (s *Store) GetServer(name string) (types.ProcessedServer, bool) {
	state := s.state.Load()
	if state == nil {
		return types.ProcessedServer{}, false
	}
	v, ok := state.Servers[name]
	return v, ok
}

func (s *Store) GetKey(id int) (string, bool) {
	state := s.state.Load()
	if state == nil {
		return "", false
	}
	v, ok := state.Keys[id]
	return v, ok
}

func (s *Store) GetBatch(country, city string) []types.ProcessedServer {
	state := s.state.Load()
	if state == nil {
		return nil
	}

	cKey := normalize(country)
	tKey := normalize(city)

	if cKey == "" {
		results := make([]types.ProcessedServer, 0, len(state.Servers))
		for _, srv := range state.Servers {
			results = append(results, srv)
		}
		return results
	}

	cities, ok := state.RegionIndex[cKey]
	if !ok {
		return nil
	}

	if tKey == "" {
		var count int
		for _, srvs := range cities {
			count += len(srvs)
		}
		results := make([]types.ProcessedServer, 0, count)
		for _, srvs := range cities {
			results = append(results, srvs...)
		}
		return results
	}

	if srvs, ok := cities[tKey]; ok {
		return srvs
	}

	return nil
}
