package generator

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"nordgen/internal/client"
	"nordgen/internal/models"
)

type conformanceExpectedServer struct {
	Name      string `json:"name"`
	Hostname  string `json:"hostname"`
	Station   string `json:"station"`
	Load      int    `json:"load"`
	Country   string `json:"country"`
	City      string `json:"city"`
	PublicKey string `json:"public_key"`
	Combo     string `json:"combo"`
}

type serverConformanceFixture struct {
	Observer         *models.Coordinates         `json:"observer"`
	RequiredGroups   []string                    `json:"required_groups"`
	ExcludeDedicated bool                        `json:"exclude_dedicated"`
	UseIP            bool                        `json:"use_ip"`
	Records          []json.RawMessage           `json:"records"`
	Expected         []conformanceExpectedServer `json:"expected"`
}

func TestServerCatalogueConformance(t *testing.T) {
	content, err := os.ReadFile(
		filepath.Join("..", "..", "testdata", "server_conformance.json"),
	)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}

	var fixture serverConformanceFixture
	if err := json.Unmarshal(content, &fixture); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}

	parsed := parseServers(
		client.DecodeServerRecords(fixture.Records),
		fixture.Observer,
		fixture.RequiredGroups,
		fixture.ExcludeDedicated,
		fixture.UseIP,
	)
	sort.Slice(parsed, func(first, second int) bool {
		return serverLess(parsed[first], parsed[second])
	})

	actual := make([]conformanceExpectedServer, 0, len(parsed))
	seenHostnames := make(map[string]struct{}, len(parsed))
	for _, server := range parsed {
		if _, duplicate := seenHostnames[server.Hostname]; duplicate {
			continue
		}
		seenHostnames[server.Hostname] = struct{}{}
		actual = append(actual, conformanceExpectedServer{
			Name:      server.Name,
			Hostname:  server.Hostname,
			Station:   server.Station,
			Load:      server.Load,
			Country:   server.Country,
			City:      server.City,
			PublicKey: server.PublicKey,
			Combo:     server.Combo,
		})
	}

	if !reflect.DeepEqual(actual, fixture.Expected) {
		t.Fatalf("conformance servers = %+v, want %+v", actual, fixture.Expected)
	}
}
