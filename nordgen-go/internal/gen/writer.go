package gen

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mustafachyi/nordvpn-wireguard-config-generator/internal/structs"
	"github.com/mustafachyi/nordvpn-wireguard-config-generator/internal/tui"
	"github.com/pterm/pterm"
)

type Writer struct {
	key      string
	prefs    structs.Preferences
	ui       *tui.Console
	dir      string
	dirCache sync.Map
}

func NewWriter(k string, p structs.Preferences, t *tui.Console) *Writer {
	return &Writer{
		key:   k,
		prefs: p,
		ui:    t,
		dir:   fmt.Sprintf("nordvpn_configs_%s", time.Now().Format("20060102_150405")),
	}
}

func (w *Writer) Commit(inv *Inventory) (string, structs.Stats) {
	if err := w.ensureDir(w.dir); err != nil {
		w.ui.Err(fmt.Sprintf("FS Error: %v", err))
		return "", structs.Stats{}
	}

	bestList := make([]structs.Server, 0, len(inv.Best))
	for _, s := range inv.Best {
		bestList = append(bestList, s)
	}

	barAll := w.ui.ProgressBar(len(inv.All), "Standard Configs")
	barBest := w.ui.ProgressBar(len(bestList), "Optimized Configs")

	w.ui.StartProgress()

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		w.writeBatch(inv.All, "configs", barAll)
	}()

	go func() {
		defer wg.Done()
		w.writeBatch(bestList, "best_configs", barBest)
	}()

	wg.Wait()
	w.ui.StopProgress()

	return w.dir, structs.Stats{
		Total:    len(inv.All),
		Best:     len(inv.Best),
		Rejected: inv.Rejected,
	}
}

func (w *Writer) ensureDir(path string) error {
	if _, ok := w.dirCache.Load(path); ok {
		return nil
	}
	err := os.MkdirAll(path, 0755)
	if err == nil {
		w.dirCache.Store(path, true)
	}
	return err
}

func (w *Writer) writeBatch(servers []structs.Server, sub string, bar *pterm.ProgressbarPrinter) {
	sem := make(chan struct{}, 200)
	var wg sync.WaitGroup

	pathMap := make(map[string]int)
	var mu sync.Mutex

	for _, s := range servers {
		wg.Add(1)
		go func(srv structs.Server) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			country := sanitize(srv.Country)
			city := sanitize(srv.City)
			base := baseName(srv)
			rel := fmt.Sprintf("%s/%s/%s/%s", sub, country, city, base)

			mu.Lock()
			fname := base
			if c, ok := pathMap[rel]; ok {
				if c == 0 {
					c = 1
				}
				raw := strings.TrimSuffix(base, ".conf")
				pathRaw := strings.TrimSuffix(rel, ".conf")
				for {
					nextRel := fmt.Sprintf("%s_%d.conf", pathRaw, c)
					if _, exists := pathMap[nextRel]; !exists {
						pathMap[rel] = c + 1
						pathMap[nextRel] = 0
						fname = fmt.Sprintf("%s_%d.conf", raw, c)
						break
					}
					c++
				}
			} else {
				pathMap[rel] = 0
			}
			mu.Unlock()

			fullPath := filepath.Join(w.dir, sub, country, city)
			w.ensureDir(fullPath)

			cfg := w.buildConfig(srv)
			os.WriteFile(filepath.Join(fullPath, fname), []byte(cfg), 0644)
			bar.Increment()
		}(s)
	}
	wg.Wait()
}

func (w *Writer) buildConfig(s structs.Server) string {
	ep := s.Host
	if w.prefs.UseIP {
		ep = s.IP
	}
	return fmt.Sprintf(
		"[Interface]\nPrivateKey = %s\nAddress = 10.5.0.2/16\nDNS = %s\n\n[Peer]\nPublicKey = %s\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = %s:51820\nPersistentKeepalive = %d",
		w.key, w.prefs.DNS, s.PubK, ep, w.prefs.Keepalive,
	)
}

func sanitize(s string) string {
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, " ", "_")
	return strings.Map(func(r rune) rune {
		if strings.ContainsRune("<>:\"/\\|?*\x00#", r) {
			return -1
		}
		return r
	}, s)
}

func baseName(s structs.Server) string {
	name := s.Name
	num := ""
	for i := len(name) - 1; i >= 0; i-- {
		if name[i] >= '0' && name[i] <= '9' {
			start := i
			for start >= 0 && name[start] >= '0' && name[start] <= '9' {
				start--
			}
			num = name[start+1 : i+1]
			break
		}
	}

	if num == "" {
		fallback := fmt.Sprintf("wg%s", strings.ReplaceAll(s.IP, ".", ""))
		if len(fallback) > 15 {
			return fallback[:15] + ".conf"
		}
		return fallback + ".conf"
	}

	base := fmt.Sprintf("%s%s", s.Code, num)
	if len(base) > 15 {
		return base[:15] + ".conf"
	}
	return base + ".conf"
}
