package store

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"nordgen/internal/types"

	"github.com/andybalholm/brotli"
)

const (
	API_URL    = "https://api.nordvpn.com/v1/servers?limit=16384&filters[servers_technologies][identifier]=wireguard_udp"
	PUBLIC_DIR = "./public"
	REFRESH    = 5 * time.Minute
)

var rxNonAlpha = regexp.MustCompile(`[^a-z0-9]+`)

type Store struct {
	sync.RWMutex
	assets     map[string]*types.Asset
	servers    map[string]types.ProcessedServer
	keys       map[int]string
	serverJson []byte
	serverEtag string
	indexRaw   []byte
	indexAsset *types.Asset
}

var Core = &Store{
	assets:  make(map[string]*types.Asset),
	servers: make(map[string]types.ProcessedServer),
	keys:    make(map[int]string),
}

func (s *Store) Init() {
	fmt.Println("[INFO ] [Store] Initializing...")
	if err := s.loadAssets(PUBLIC_DIR); err != nil {
		fmt.Printf("[ERROR] [Store] Asset load failed: %v\n", err)
	}
	s.updateServers()
	go func() {
		ticker := time.NewTicker(REFRESH)
		for range ticker.C {
			s.updateServers()
		}
	}()
	fmt.Println("[INFO ] [Store] Ready.")
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

		s.Lock()
		s.assets[webPath] = &types.Asset{
			Content: content,
			Brotli:  brContent,
			Mime:    mimeType,
			Etag:    fmt.Sprintf(`W/"%x-%x"`, len(content), time.Now().UnixMilli()),
		}
		s.Unlock()
	}
	return nil
}

func (s *Store) updateServers() {
	fmt.Println("[INFO ] [Store] Updating server list...")
	resp, err := http.Get(API_URL)
	if err != nil {
		fmt.Printf("[ERROR] [Store] Update failed: %v\n", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		fmt.Printf("[ERROR] [Store] API Status: %s\n", resp.Status)
		return
	}

	var raw []types.RawServer
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		fmt.Printf("[ERROR] [Store] JSON Decode: %v\n", err)
		return
	}

	newServers := make(map[string]types.ProcessedServer)
	newKeys := make(map[string]int)
	keyMap := make(map[int]string)
	payload := types.ServerPayload{
		Headers: []string{"name", "load", "station"},
		List:    make(map[string]map[string][][]interface{}),
	}

	kID := 1
	normalize := func(str string) string {
		return rxNonAlpha.ReplaceAllString(strings.ToLower(str), "_")
	}

	for _, srv := range raw {
		if len(srv.Locations) == 0 {
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
			keyMap[id] = pk
		}

		name := normalize(srv.Name)
		country := normalize(loc.Country.Name)
		city := normalize(loc.Country.City.Name)

		newServers[name] = types.ProcessedServer{
			Name:     name,
			Station:  srv.Station,
			Hostname: srv.Hostname,
			Country:  country,
			City:     city,
			KeyID:    id,
		}

		if payload.List[country] == nil {
			payload.List[country] = make(map[string][][]interface{})
		}
		payload.List[country][city] = append(payload.List[country][city], []interface{}{name, srv.Load, srv.Station})
	}

	jsonData, _ := json.Marshal(payload)
	etag := fmt.Sprintf(`W/"%s"`, strings.Trim(fmt.Sprintf("%x", time.Now().UnixNano()), "-"))

	s.Lock()
	s.servers = newServers
	s.keys = keyMap
	s.serverJson = jsonData
	s.serverEtag = etag
	s.rebuildIndex()
	s.Unlock()

	fmt.Printf("[INFO ] [Store] Cached %d servers.\n", len(newServers))
}

func (s *Store) rebuildIndex() {
	if s.indexRaw == nil {
		return
	}
	script := fmt.Sprintf(`<script id="server-data" type="application/json">%s</script>`, s.serverJson)
	htmlStr := strings.Replace(string(s.indexRaw), "</body>", script+"</body>", 1)
	content := []byte(htmlStr)

	var buf bytes.Buffer
	w := brotli.NewWriterLevel(&buf, brotli.BestCompression)
	w.Write(content)
	w.Close()

	s.indexAsset = &types.Asset{
		Content: content,
		Brotli:  buf.Bytes(),
		Mime:    "text/html; charset=utf-8",
		Etag:    s.serverEtag,
	}
}

func (s *Store) GetAsset(path string) *types.Asset {
	s.RLock()
	defer s.RUnlock()
	if path == "/" || path == "/index.html" {
		return s.indexAsset
	}
	return s.assets[path]
}

func (s *Store) GetServerList() ([]byte, string) {
	s.RLock()
	defer s.RUnlock()
	return s.serverJson, s.serverEtag
}

func (s *Store) GetServer(name string) (types.ProcessedServer, bool) {
	s.RLock()
	defer s.RUnlock()
	v, ok := s.servers[name]
	return v, ok
}

func (s *Store) GetKey(id int) (string, bool) {
	s.RLock()
	defer s.RUnlock()
	v, ok := s.keys[id]
	return v, ok
}
