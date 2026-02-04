package gen

import (
	"fmt"
	"math"
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/mustafachyi/nordvpn-wireguard-config-generator/internal/client"
	"github.com/mustafachyi/nordvpn-wireguard-config-generator/internal/structs"
)

type Inventory struct {
	All      []structs.Server
	Best     map[string]structs.Server
	Rejected int
}

type Loader struct {
	result chan *Inventory
	err    chan error
}

func NewLoader(api *client.Nord) *Loader {
	l := &Loader{
		result: make(chan *Inventory, 1),
		err:    make(chan error, 1),
	}
	go l.start(api)
	return l
}

func (l *Loader) Await() (*Inventory, error) {
	select {
	case res := <-l.result:
		return res, nil
	case err := <-l.err:
		return nil, err
	}
}

func (l *Loader) start(api *client.Nord) {
	var lat, lon float64
	var raw []structs.ApiServer
	var errGeo, errSrv error
	var wg sync.WaitGroup

	wg.Add(2)

	go func() {
		defer wg.Done()
		lat, lon, errGeo = api.FetchGeo()
	}()

	go func() {
		defer wg.Done()
		raw, errSrv = api.FetchServers()
	}()

	wg.Wait()

	if errGeo != nil || errSrv != nil {
		l.err <- fmt.Errorf("fetch error")
		return
	}

	processed, rejected := process(raw, lat, lon)

	sort.Sort(byLoadDist(processed))

	best := make(map[string]structs.Server)
	for _, s := range processed {
		key := fmt.Sprintf("%s|%s", s.Country, s.City)
		if current, exists := best[key]; !exists || s.Load < current.Load {
			best[key] = s
		}
	}

	l.result <- &Inventory{
		All:      processed,
		Best:     best,
		Rejected: rejected,
	}
}

func process(raw []structs.ApiServer, uLat, uLon float64) ([]structs.Server, int) {
	var out []structs.Server
	var mu sync.Mutex
	var wg sync.WaitGroup

	sem := make(chan struct{}, runtime.NumCPU())

	for i := range raw {
		wg.Add(1)
		go func(srv *structs.ApiServer) {
			defer wg.Done()
			sem <- struct{}{}
			p := parse(srv, uLat, uLon)
			<-sem
			if p != nil {
				mu.Lock()
				out = append(out, *p)
				mu.Unlock()
			}
		}(&raw[i])
	}
	wg.Wait()

	uniq := make(map[string]structs.Server, len(out))
	for _, s := range out {
		if _, ok := uniq[s.Name]; !ok {
			uniq[s.Name] = s
		}
	}

	res := make([]structs.Server, 0, len(uniq))
	for _, s := range uniq {
		res = append(res, s)
	}

	return res, len(raw) - len(res)
}

func parse(s *structs.ApiServer, lat, lon float64) *structs.Server {
	if len(s.Locations) == 0 {
		return nil
	}

	ver := "0.0.0"
	for _, sp := range s.Specs {
		if sp.ID == "version" && len(sp.Values) > 0 {
			ver = sp.Values[0].Value
			break
		}
	}

	if !checkVer(ver) {
		return nil
	}

	pk := ""
	for _, t := range s.Tech {
		if t.ID == "wireguard_udp" {
			for _, m := range t.Meta {
				if m.Name == "public_key" {
					pk = m.Value
					break
				}
			}
		}
	}
	if pk == "" {
		return nil
	}

	loc := s.Locations[0]
	dist := haversine(lat, lon, loc.Lat, loc.Lon)

	return &structs.Server{
		Name:    s.Name,
		Host:    s.Hostname,
		IP:      s.Station,
		Load:    s.Load,
		Country: loc.Country.Name,
		Code:    strings.ToLower(loc.Country.Code),
		City:    loc.Country.City.Name,
		Lat:     loc.Lat,
		Lon:     loc.Lon,
		PubK:    pk,
		Dist:    dist,
	}
}

func checkVer(v string) bool {
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
	}

	return min >= 1
}

func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371
	dLat := (lat2 - lat1) * (math.Pi / 180.0)
	dLon := (lon2 - lon1) * (math.Pi / 180.0)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*(math.Pi/180.0))*math.Cos(lat2*(math.Pi/180.0))*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	return R * (2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a)))
}

type byLoadDist []structs.Server

func (a byLoadDist) Len() int      { return len(a) }
func (a byLoadDist) Swap(i, j int) { a[i], a[j] = a[j], a[i] }
func (a byLoadDist) Less(i, j int) bool {
	if a[i].Load != a[j].Load {
		return a[i].Load < a[j].Load
	}
	return a[i].Dist < a[j].Dist
}
