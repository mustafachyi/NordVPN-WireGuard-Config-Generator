package store

import (
	"bytes"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"nordgen/internal/types"

	"github.com/andybalholm/brotli"
	"github.com/bytedance/sonic"
	kgzip "github.com/klauspost/compress/gzip"
)

const (
	API_URL    = "https://api.nordvpn.com/v1/servers?limit=16384&filters[servers_technologies][identifier]=wireguard_udp"
	PUBLIC_DIR = "./public"
	REFRESH    = 5 * time.Minute
)

var (
	refreshClient = &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			ForceAttemptHTTP2:   true,
			MaxIdleConns:        10,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	bodyClose = []byte("</body>")
)

type State struct {
	Servers     map[string]types.ProcessedServer
	Keys        map[int]string
	RegionIndex map[string]map[string][]types.ProcessedServer
	CountryFlat map[string][]types.ProcessedServer
	AllServers  []types.ProcessedServer
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

func (s *Store) LoadState() *State {
	return s.state.Load()
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

		name := entry.Name()
		if strings.HasSuffix(name, ".br") || strings.HasSuffix(name, ".gz") {
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
		if data, err := os.ReadFile(path + ".br"); err == nil {
			brContent = data
		} else {
			var brBuf bytes.Buffer
			brw := brotli.NewWriterLevel(&brBuf, brotli.BestCompression)
			brw.Write(content)
			brw.Close()
			brContent = brBuf.Bytes()
		}

		var gzContent []byte
		if data, err := os.ReadFile(path + ".gz"); err == nil {
			gzContent = data
		} else {
			var gzBuf bytes.Buffer
			gzw, _ := kgzip.NewWriterLevel(&gzBuf, kgzip.BestCompression)
			gzw.Write(content)
			gzw.Close()
			gzContent = gzBuf.Bytes()
		}

		mimeType := mime.TypeByExtension(filepath.Ext(path))
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}

		etag := buildEtag(len(content), time.Now().UnixMilli())

		s.assets[webPath] = &types.Asset{
			Content: content,
			Brotli:  brContent,
			Gzip:    gzContent,
			Mime:    mimeType,
			Etag:    etag,
		}
	}
	return nil
}

func buildEtag(size int, ts int64) string {
	buf := make([]byte, 0, 32)
	buf = append(buf, 'W', '/', '"')
	buf = strconv.AppendInt(buf, int64(size), 16)
	buf = append(buf, '-')
	buf = strconv.AppendInt(buf, ts, 16)
	buf = append(buf, '"')
	return string(buf)
}

func buildServerEtag(ts int64) string {
	buf := make([]byte, 0, 24)
	buf = append(buf, 'W', '/', '"')
	buf = strconv.AppendInt(buf, ts, 16)
	buf = append(buf, '"')
	return string(buf)
}

func toLower(s string) string {
	for i := 0; i < len(s); i++ {
		if s[i] >= 'A' && s[i] <= 'Z' {
			b := make([]byte, len(s))
			copy(b, s[:i])
			for ; i < len(s); i++ {
				c := s[i]
				if c >= 'A' && c <= 'Z' {
					c += 32
				}
				b[i] = c
			}
			return string(b)
		}
	}
	return s
}

func extractNumber(s string) string {
	start := -1
	for i := 0; i < len(s); i++ {
		if s[i] >= '0' && s[i] <= '9' {
			if start == -1 {
				start = i
			}
		} else {
			if start != -1 {
				return s[start:i]
			}
		}
	}
	if start != -1 {
		return s[start:]
	}
	return ""
}

func buildFileName(lowCode, number string) string {
	buf := make([]byte, 0, len(lowCode)+len(number)+5)
	buf = append(buf, lowCode...)
	buf = append(buf, number...)
	buf = append(buf, '.', 'c', 'o', 'n', 'f')
	return string(buf)
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
	resp, err := refreshClient.Get(API_URL)
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
		CountryFlat: make(map[string][]types.ProcessedServer),
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
		lowCode := intern(toLower(code))

		num := extractNumber(name)
		if num == "" {
			num = "wg"
		}
		fileName := buildFileName(lowCode, num)

		processed := types.ProcessedServer{
			Name:     name,
			Station:  srv.Station,
			Hostname: srv.Hostname,
			Country:  country,
			City:     city,
			Code:     code,
			LowCode:  lowCode,
			Number:   num,
			FileName: fileName,
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

	allServers := make([]types.ProcessedServer, 0, len(state.Servers))
	for _, srv := range state.Servers {
		allServers = append(allServers, srv)
	}
	state.AllServers = allServers

	for country, cities := range state.RegionIndex {
		var count int
		for _, srvs := range cities {
			count += len(srvs)
		}
		flat := make([]types.ProcessedServer, 0, count)
		for _, srvs := range cities {
			flat = append(flat, srvs...)
		}
		state.CountryFlat[country] = flat
	}

	jsonData, err := sonic.Marshal(payload)
	if err != nil {
		return
	}

	state.ServerJson = jsonData
	state.ServerEtag = buildServerEtag(time.Now().UnixNano())

	s.rebuildIndex(state)
	s.state.Store(state)
}

func (s *Store) rebuildIndex(state *State) {
	if s.indexRaw == nil {
		return
	}

	scriptPrefix := []byte(`<script id="server-data" type="application/json">`)
	scriptSuffix := []byte(`</script>`)

	injection := make([]byte, 0, len(scriptPrefix)+len(state.ServerJson)+len(scriptSuffix)+len(bodyClose))
	injection = append(injection, scriptPrefix...)
	injection = append(injection, state.ServerJson...)
	injection = append(injection, scriptSuffix...)
	injection = append(injection, bodyClose...)

	content := bytes.Replace(s.indexRaw, bodyClose, injection, 1)

	var brBuf bytes.Buffer
	brw := brotli.NewWriterLevel(&brBuf, brotli.BestCompression)
	brw.Write(content)
	brw.Close()

	var gzBuf bytes.Buffer
	gzw, _ := kgzip.NewWriterLevel(&gzBuf, kgzip.BestCompression)
	gzw.Write(content)
	gzw.Close()

	state.IndexAsset = &types.Asset{
		Content: content,
		Brotli:  brBuf.Bytes(),
		Gzip:    gzBuf.Bytes(),
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
	return s.GetBatchFromState(state, country, city)
}

func (s *Store) GetBatchFromState(state *State, country, city string) []types.ProcessedServer {
	cKey := normalize(country)
	tKey := normalize(city)

	if cKey == "" {
		return state.AllServers
	}

	if tKey == "" {
		return state.CountryFlat[cKey]
	}

	cities, ok := state.RegionIndex[cKey]
	if !ok {
		return nil
	}

	return cities[tKey]
}
