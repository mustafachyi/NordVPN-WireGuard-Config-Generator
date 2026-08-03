package client

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func validKey(fill byte) string {
	value := make([]byte, 32)
	for index := range value {
		value[index] = fill
	}
	return base64.StdEncoding.EncodeToString(value)
}

func newTestClient(server *httptest.Server) *NordClient {
	return newNordClient(server.Client(), endpoints{
		creds:   server.URL + "/creds",
		geo:     server.URL + "/geo",
		servers: server.URL + "/servers",
	})
}

func TestNewNordClientConfiguration(t *testing.T) {
	client := NewNordClient()
	if client.httpClient.Timeout != 25*time.Second {
		t.Fatalf("Timeout = %v", client.httpClient.Timeout)
	}
	transport, ok := client.httpClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("Transport = %T", client.httpClient.Transport)
	}
	if transport.MaxIdleConns != 10 || transport.MaxIdleConnsPerHost != 10 || transport.ResponseHeaderTimeout != 15*time.Second {
		t.Fatalf("transport = %+v", transport)
	}
	request := httptest.NewRequest(http.MethodGet, "https://example.com", nil)
	if err := client.httpClient.CheckRedirect(request, nil); !errors.Is(err, http.ErrUseLastResponse) {
		t.Fatalf("CheckRedirect() error = %v", err)
	}
}

func TestGetKey(t *testing.T) {
	key := validKey(7)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/creds" {
			http.NotFound(writer, request)
			return
		}
		if request.Header.Get("Accept") != "application/json" {
			t.Error("Accept header missing")
		}
		if request.Header.Get("User-Agent") != userAgent {
			t.Errorf("User-Agent = %q", request.Header.Get("User-Agent"))
		}
		wantAuth := "Basic " + base64.StdEncoding.EncodeToString([]byte("token:"+strings.Repeat("a", 64)))
		if request.Header.Get("Authorization") != wantAuth {
			t.Errorf("Authorization = %q", request.Header.Get("Authorization"))
		}
		_, _ = fmt.Fprintf(writer, `{"nordlynx_private_key":%q}`, "  "+key+"  ")
	}))
	defer server.Close()

	got, err := newTestClient(server).GetKey(context.Background(), strings.Repeat("a", 64))
	if err != nil {
		t.Fatalf("GetKey() error = %v", err)
	}
	if got != key {
		t.Fatalf("GetKey() = %q, want %q", got, key)
	}
}

func TestGetKeyUnauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	_, err := newTestClient(server).GetKey(context.Background(), strings.Repeat("a", 64))
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("GetKey() error = %v, want ErrUnauthorized", err)
	}
}

func TestGetKeyRejectsInvalidKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(`{"nordlynx_private_key":"invalid"}`))
	}))
	defer server.Close()

	if _, err := newTestClient(server).GetKey(context.Background(), strings.Repeat("a", 64)); err == nil {
		t.Fatal("GetKey() succeeded")
	}
}

func TestGetGeo(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(`{"latitude":36.75,"longitude":3.06}`))
	}))
	defer server.Close()

	coordinates, err := newTestClient(server).GetGeo(context.Background())
	if err != nil {
		t.Fatalf("GetGeo() error = %v", err)
	}
	if coordinates.Latitude != 36.75 || coordinates.Longitude != 3.06 {
		t.Fatalf("GetGeo() = %+v", coordinates)
	}
}

func TestGetGeoRejectsInvalidCoordinates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(`{"latitude":91,"longitude":3.06}`))
	}))
	defer server.Close()

	if _, err := newTestClient(server).GetGeo(context.Background()); err == nil {
		t.Fatal("GetGeo() succeeded")
	}
}

func TestGetGeoRejectsMissingCoordinates(t *testing.T) {
	for _, payload := range []string{`{}`, `{"latitude":36.75}`, `{"longitude":3.06}`} {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			_, _ = writer.Write([]byte(payload))
		}))
		_, err := newTestClient(server).GetGeo(context.Background())
		server.Close()
		if err == nil {
			t.Fatalf("GetGeo() accepted %s", payload)
		}
	}
}

func TestGetServers(t *testing.T) {
	publicKey := validKey(8)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/servers" {
			http.NotFound(writer, request)
			return
		}
		_, _ = fmt.Fprintf(
			writer,
			`[{"hostname":"us1.example.com","station":"192.0.2.1","load":10,"locations":[{"latitude":36.75,"longitude":3.06,"country":{"name":"Algeria","city":{"name":"Algiers"}}}],"groups":[{"identifier":"legacy_standard"}],"technologies":[{"metadata":[{"name":"public_key","value":%q}]}]}]`,
			publicKey,
		)
	}))
	defer server.Close()

	servers, err := newTestClient(server).GetServers(context.Background())
	if err != nil {
		t.Fatalf("GetServers() error = %v", err)
	}
	if len(servers) != 1 {
		t.Fatalf("GetServers() returned %d records, want 1", len(servers))
	}

	got := servers[0]
	if got.Hostname != "us1.example.com" ||
		got.Station != "192.0.2.1" ||
		got.Load != 10 ||
		len(got.Locations) != 1 ||
		len(got.Groups) != 1 ||
		len(got.Technologies) != 1 {
		t.Fatalf("GetServers() = %+v", servers)
	}
}

func TestGetServersRejectsEmptyList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(`[]`))
	}))
	defer server.Close()

	if _, err := newTestClient(server).GetServers(context.Background()); err == nil {
		t.Fatal("GetServers() succeeded")
	}
}

func TestGetJSONFailures(t *testing.T) {
	tests := []struct {
		name    string
		handler http.HandlerFunc
		limit   int64
	}{
		{
			name: "status",
			handler: func(writer http.ResponseWriter, request *http.Request) {
				writer.WriteHeader(http.StatusBadGateway)
			},
			limit: 64,
		},
		{
			name:    "empty",
			handler: func(writer http.ResponseWriter, request *http.Request) {},
			limit:   64,
		},
		{
			name: "malformed",
			handler: func(writer http.ResponseWriter, request *http.Request) {
				_, _ = writer.Write([]byte("{"))
			},
			limit: 64,
		},
		{
			name: "trailing",
			handler: func(writer http.ResponseWriter, request *http.Request) {
				_, _ = writer.Write([]byte(`{} {}`))
			},
			limit: 64,
		},
		{
			name: "oversized",
			handler: func(writer http.ResponseWriter, request *http.Request) {
				_, _ = writer.Write([]byte(strings.Repeat("x", 65)))
			},
			limit: 64,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(test.handler)
			defer server.Close()

			client := newNordClient(server.Client(), endpoints{})
			var destination map[string]any
			if err := client.getJSON(context.Background(), server.URL, nil, test.limit, &destination); err == nil {
				t.Fatal("getJSON() succeeded")
			}
		})
	}
}

func TestGetJSONHonorsContext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		<-request.Context().Done()
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	client := newNordClient(server.Client(), endpoints{})
	var destination map[string]any
	if err := client.getJSON(ctx, server.URL, nil, 64, &destination); err == nil {
		t.Fatal("getJSON() succeeded")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

type failingBody struct{}

func (failingBody) Read([]byte) (int, error) {
	return 0, errors.New("read failed")
}

func (failingBody) Close() error {
	return nil
}

func TestGetJSONRequestAndTransportFailures(t *testing.T) {
	client := newNordClient(&http.Client{}, endpoints{})
	var destination map[string]any
	if err := client.getJSON(context.Background(), "://", nil, 64, &destination); err == nil {
		t.Fatal("getJSON() accepted an invalid URL")
	}

	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("transport failed")
	})
	if err := client.getJSON(context.Background(), "https://example.com", nil, 64, &destination); err == nil {
		t.Fatal("getJSON() accepted a transport failure")
	}
}

func TestGetJSONReadAndTrailingFailures(t *testing.T) {
	client := newNordClient(&http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       failingBody{},
			Header:     make(http.Header),
		}, nil
	})}, endpoints{})

	var destination map[string]any
	if err := client.getJSON(context.Background(), "https://example.com", nil, 64, &destination); err == nil || !strings.Contains(err.Error(), "decode response") {
		t.Fatalf("getJSON() error = %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = io.WriteString(writer, `{} trailing`)
	}))
	defer server.Close()

	client = newNordClient(server.Client(), endpoints{})
	if err := client.getJSON(context.Background(), server.URL, nil, 64, &destination); err == nil || !strings.Contains(err.Error(), "trailing") {
		t.Fatalf("getJSON() error = %v", err)
	}
}
