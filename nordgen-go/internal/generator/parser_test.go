package generator

import (
	"encoding/base64"
	"math"
	"testing"

	"nordgen/internal/constants"
	"nordgen/internal/models"
)

func parserKey(fill byte) string {
	value := make([]byte, 32)
	for index := range value {
		value[index] = fill
	}
	return base64.StdEncoding.EncodeToString(value)
}

func rawServer(hostname string, load int, latitude, longitude float64, groups ...string) models.RawServer {
	rawGroups := make([]models.RawGroup, len(groups))
	for index, group := range groups {
		rawGroups[index] = models.RawGroup{Identifier: group}
	}
	return models.RawServer{
		Hostname: hostname,
		Station:  "192.0.2.1",
		Load:     load,
		Locations: []models.RawLocation{{
			Latitude:  latitude,
			Longitude: longitude,
			Country: models.RawCountry{
				Name: "Country",
				City: models.RawCity{Name: "City"},
			},
		}},
		Groups: rawGroups,
		Technologies: []models.RawTechnology{{Metadata: []models.RawMetadata{{
			Name:  "public_key",
			Value: parserKey(2),
		}}}},
	}
}

func TestParseServersFiltersAndDeduplicatesGroups(t *testing.T) {
	standard := constants.GroupStandardID
	p2p := constants.GroupP2PID
	first := rawServer("  US1.EXAMPLE.COM  ", 10, 1, 1, standard, p2p, standard)
	first.Technologies[0].Metadata[0].Value = "  " + parserKey(2) + "  "
	servers := []models.RawServer{
		first,
		rawServer("us2.example.com", 20, 2, 2, standard),
	}
	observer := &models.Coordinates{Latitude: 0, Longitude: 0}
	parsed := parseServers(servers, observer, []string{standard, p2p}, false, false)
	if len(parsed) != 1 {
		t.Fatalf("parseServers() returned %d servers", len(parsed))
	}
	if parsed[0].Hostname != "us1.example.com" || parsed[0].Name != "us1" {
		t.Fatalf("normalized server = %+v", parsed[0])
	}
	if parsed[0].Combo != "p2p_standard" {
		t.Fatalf("Combo = %q", parsed[0].Combo)
	}
	if parsed[0].Distance <= 0 {
		t.Fatalf("Distance = %f", parsed[0].Distance)
	}
}

func TestParseServersExcludesDedicated(t *testing.T) {
	dedicated := constants.GroupDedicatedID
	standard := constants.GroupStandardID
	servers := []models.RawServer{
		rawServer("us1.example.com", 10, 1, 1, standard, dedicated),
		rawServer("us2.example.com", 20, 2, 2, standard),
	}
	parsed := parseServers(servers, nil, nil, true, false)
	if len(parsed) != 1 || parsed[0].Hostname != "us2.example.com" {
		t.Fatalf("parseServers() = %+v", parsed)
	}
	if parsed[0].Distance != 0 {
		t.Fatalf("Distance = %f, want 0", parsed[0].Distance)
	}
}

func TestParseServersRequiresValidIPWhenRequested(t *testing.T) {
	server := rawServer("us1.example.com", 10, 1, 1, constants.GroupStandardID)
	server.Station = "not-an-ip"
	if parsed := parseServers([]models.RawServer{server}, nil, nil, false, true); len(parsed) != 0 {
		t.Fatalf("parseServers() = %+v", parsed)
	}
	server.Station = "2001:db8::1"
	parsed := parseServers([]models.RawServer{server}, nil, nil, false, true)
	if len(parsed) != 1 || parsed[0].Station != "2001:db8::1" {
		t.Fatalf("parseServers() = %+v", parsed)
	}
}

func TestParseServersRejectsInvalidRecords(t *testing.T) {
	standard := constants.GroupStandardID
	mutate := func(change func(*models.RawServer)) models.RawServer {
		server := rawServer("us1.example.com", 10, 1, 1, standard)
		change(&server)
		return server
	}
	cases := []models.RawServer{
		mutate(func(server *models.RawServer) { server.Load = -1 }),
		mutate(func(server *models.RawServer) { server.Load = 101 }),
		mutate(func(server *models.RawServer) { server.Hostname = "invalid" }),
		mutate(func(server *models.RawServer) { server.Groups = nil }),
		mutate(func(server *models.RawServer) { server.Locations = nil }),
		mutate(func(server *models.RawServer) { server.Locations[0].Latitude = math.NaN() }),
		mutate(func(server *models.RawServer) { server.Locations[0].Country.Name = "" }),
		mutate(func(server *models.RawServer) { server.Technologies[0].Metadata[0].Value = "bad" }),
	}
	for index, value := range cases {
		if parsed := parseServers([]models.RawServer{value}, nil, nil, false, false); len(parsed) != 0 {
			t.Errorf("case %d returned %+v", index, parsed)
		}
	}
}

func TestCalculateDistance(t *testing.T) {
	distance := calculateDistance(0, 0, 1, 0, 1)
	if math.Abs(distance-111.195) > 0.1 {
		t.Fatalf("calculateDistance() = %.3f", distance)
	}
}
