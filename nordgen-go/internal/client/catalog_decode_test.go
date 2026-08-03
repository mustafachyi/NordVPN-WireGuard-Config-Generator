package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestGetServersIsolatesMalformedCatalogueRecords(t *testing.T) {
	fixtureContent, err := os.ReadFile(
		filepath.Join("..", "..", "testdata", "server_conformance.json"),
	)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}

	var fixture struct {
		Records []json.RawMessage `json:"records"`
	}
	if err := json.Unmarshal(fixtureContent, &fixture); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	catalogue, err := json.Marshal(fixture.Records)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write(catalogue)
	}))
	defer server.Close()

	client := newNordClient(server.Client(), endpoints{servers: server.URL})
	servers, err := client.GetServers(context.Background())
	if err != nil {
		t.Fatalf("GetServers() error = %v", err)
	}
	if len(servers) != len(fixture.Records) {
		t.Fatalf("GetServers() returned %d records, want %d", len(servers), len(fixture.Records))
	}

	for _, index := range []int{4, 5, 6, 11} {
		if servers[index].Hostname != "" || len(servers[index].Locations) != 0 {
			t.Errorf("malformed record %d decoded as %+v", index, servers[index])
		}
	}

	if servers[8].Hostname != "us3.example.com" || len(servers[8].Locations) != 1 {
		t.Fatalf("record with an unused malformed location decoded as %+v", servers[8])
	}
	if servers[9].Hostname != "us4.example.com" || len(servers[9].Groups) != 2 {
		t.Fatalf("record with malformed group entries decoded as %+v", servers[9])
	}
	if servers[10].Hostname != "us5.example.com" || len(servers[10].Technologies) != 1 {
		t.Fatalf("record with malformed technology entries decoded as %+v", servers[10])
	}
}

func TestDecodeServerRecordRejectsMalformedRequiredFields(t *testing.T) {
	validLocation := `{"latitude":1,"longitude":1,"country":{"name":"Country","city":{"name":"City"}}}`
	tests := []string{
		`{}`,
		`{"hostname":"us1.example.com"}`,
		`{"hostname":"us1.example.com","load":10,"locations":{}}`,
		`{"hostname":"us1.example.com","load":10,"locations":[]}`,
		`{"hostname":"us1.example.com","load":10,"locations":[null]}`,
		`{"hostname":"us1.example.com","load":10,"locations":[{"latitude":1}]}`,
		`{"hostname":"us1.example.com","load":10,"locations":[{"latitude":1,"longitude":1,"country":null}]}`,
		`{"hostname":"us1.example.com","load":10,"locations":[{"latitude":1,"longitude":1,"country":{"name":1,"city":{"name":"City"}}}]}`,
		`{"hostname":"us1.example.com","load":10,"locations":[{"latitude":1,"longitude":1,"country":{"name":"Country","city":null}}]}`,
		`{"hostname":"us1.example.com","load":10,"locations":[{"latitude":1,"longitude":1,"country":{"name":"Country","city":{"name":1}}}]}`,
	}

	for _, value := range tests {
		if server, ok := decodeServerRecord(json.RawMessage(value)); ok {
			t.Errorf("decodeServerRecord(%s) = %+v, true", value, server)
		}
	}

	valid := json.RawMessage(
		`{"hostname":"us1.example.com","load":10,"locations":[` + validLocation + `],"groups":{},"technologies":{}}`,
	)
	server, ok := decodeServerRecord(valid)
	if !ok {
		t.Fatal("decodeServerRecord() rejected structurally valid required fields")
	}
	if server.Groups != nil || server.Technologies != nil {
		t.Fatalf("optional malformed collections decoded as %+v", server)
	}
}

func TestDecodeOptionalCollectionsIgnoreMalformedEntries(t *testing.T) {
	groups := decodeGroups(json.RawMessage(
		`[null,{}, {"identifier":1}, {"identifier":"legacy_standard"}]`,
	))
	if len(groups) != 1 || groups[0].Identifier != "legacy_standard" {
		t.Fatalf("decodeGroups() = %+v", groups)
	}

	technologies := decodeTechnologies(json.RawMessage(
		`[null,{}, {"metadata":{}}, {"metadata":[null,{}, {"name":1,"value":"x"}, {"name":"public_key","value":1}, {"name":"public_key","value":"key"}]}]`,
	))
	if len(technologies) != 1 || len(technologies[0].Metadata) != 1 {
		t.Fatalf("decodeTechnologies() = %+v", technologies)
	}
	metadata := technologies[0].Metadata[0]
	if metadata.Name != "public_key" || metadata.Value != "key" {
		t.Fatalf("metadata = %+v", metadata)
	}
}
