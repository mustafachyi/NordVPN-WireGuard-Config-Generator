package client

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"nordgen/internal/constants"
	"nordgen/internal/models"
	"nordgen/internal/wireguard"
)

const (
	credentialsResponseLimit = 64 * 1024
	geoResponseLimit         = 64 * 1024
	serversResponseLimit     = 64 * 1024 * 1024
	userAgent                = "nordgen/1"
)

var ErrUnauthorized = errors.New("unauthorized")

type endpoints struct {
	servers string
	geo     string
	creds   string
}

type NordClient struct {
	httpClient *http.Client
	endpoints  endpoints
}

func NewNordClient() *NordClient {
	var transport *http.Transport
	if defaultTransport, ok := http.DefaultTransport.(*http.Transport); ok {
		transport = defaultTransport.Clone()
	} else {
		transport = &http.Transport{}
	}
	transport.MaxIdleConns = 10
	transport.MaxIdleConnsPerHost = 10
	transport.IdleConnTimeout = 30 * time.Second
	transport.ResponseHeaderTimeout = 15 * time.Second

	return newNordClient(&http.Client{
		Timeout:   25 * time.Second,
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}, endpoints{
		servers: constants.ServersURL,
		geo:     constants.GeoURL,
		creds:   constants.CredsURL,
	})
}

func newNordClient(httpClient *http.Client, target endpoints) *NordClient {
	return &NordClient{
		httpClient: httpClient,
		endpoints:  target,
	}
}

func (c *NordClient) GetKey(ctx context.Context, token string) (string, error) {
	headers := make(http.Header, 1)
	auth := base64.StdEncoding.EncodeToString([]byte("token:" + token))
	headers.Set("Authorization", "Basic "+auth)

	var payload struct {
		NordlynxPrivateKey string `json:"nordlynx_private_key"`
	}
	if err := c.getJSON(ctx, c.endpoints.creds, headers, credentialsResponseLimit, &payload); err != nil {
		return "", fmt.Errorf("get credentials: %w", err)
	}
	privateKey := strings.TrimSpace(payload.NordlynxPrivateKey)
	if err := wireguard.ValidateKey(privateKey); err != nil {
		return "", fmt.Errorf("credentials response contained an invalid private key: %w", err)
	}
	return privateKey, nil
}

func (c *NordClient) GetGeo(ctx context.Context) (models.Coordinates, error) {
	var payload struct {
		Latitude  *float64 `json:"latitude"`
		Longitude *float64 `json:"longitude"`
	}
	if err := c.getJSON(ctx, c.endpoints.geo, nil, geoResponseLimit, &payload); err != nil {
		return models.Coordinates{}, fmt.Errorf("get geolocation: %w", err)
	}
	if payload.Latitude == nil || payload.Longitude == nil ||
		*payload.Latitude < -90 || *payload.Latitude > 90 ||
		*payload.Longitude < -180 || *payload.Longitude > 180 {
		return models.Coordinates{}, fmt.Errorf("geolocation response contained invalid coordinates")
	}
	return models.Coordinates{Latitude: *payload.Latitude, Longitude: *payload.Longitude}, nil
}

func (c *NordClient) GetServers(ctx context.Context) ([]models.RawServer, error) {
	var records []json.RawMessage
	if err := c.getJSON(ctx, c.endpoints.servers, nil, serversResponseLimit, &records); err != nil {
		return nil, fmt.Errorf("get servers: %w", err)
	}
	if len(records) == 0 {
		return nil, fmt.Errorf("server response was empty")
	}
	return DecodeServerRecords(records), nil
}

func DecodeServerRecords(records []json.RawMessage) []models.RawServer {
	servers := make([]models.RawServer, len(records))
	for index, record := range records {
		server, ok := decodeServerRecord(record)
		if ok {
			servers[index] = server
		}
	}
	return servers
}

func decodeServerRecord(value json.RawMessage) (models.RawServer, bool) {
	object, ok := decodeObject(value)
	if !ok {
		return models.RawServer{}, false
	}

	hostname, ok := decodeString(object["hostname"])
	if !ok {
		return models.RawServer{}, false
	}
	load, ok := decodeInt(object["load"])
	if !ok {
		return models.RawServer{}, false
	}
	locations, ok := decodeArray(object["locations"])
	if !ok || len(locations) == 0 {
		return models.RawServer{}, false
	}

	decodedLocations := make([]models.RawLocation, 0, len(locations))
	for index, value := range locations {
		location, locationOK := decodeLocation(value)
		if !locationOK {
			if index == 0 {
				return models.RawServer{}, false
			}
			continue
		}
		decodedLocations = append(decodedLocations, location)
	}

	station, _ := decodeString(object["station"])
	return models.RawServer{
		Hostname:     hostname,
		Station:      station,
		Load:         load,
		Locations:    decodedLocations,
		Groups:       decodeGroups(object["groups"]),
		Technologies: decodeTechnologies(object["technologies"]),
	}, true
}

func decodeObject(value json.RawMessage) (map[string]json.RawMessage, bool) {
	var object map[string]json.RawMessage
	if len(value) == 0 || json.Unmarshal(value, &object) != nil || object == nil {
		return nil, false
	}
	return object, true
}

func decodeString(value json.RawMessage) (string, bool) {
	var decoded *string
	if len(value) == 0 || json.Unmarshal(value, &decoded) != nil || decoded == nil {
		return "", false
	}
	return *decoded, true
}

func decodeInt(value json.RawMessage) (int, bool) {
	var decoded *int
	if len(value) == 0 || json.Unmarshal(value, &decoded) != nil || decoded == nil {
		return 0, false
	}
	return *decoded, true
}

func decodeFloat(value json.RawMessage) (float64, bool) {
	var decoded *float64
	if len(value) == 0 || json.Unmarshal(value, &decoded) != nil || decoded == nil {
		return 0, false
	}
	return *decoded, true
}

func decodeArray(value json.RawMessage) ([]json.RawMessage, bool) {
	var decoded []json.RawMessage
	if len(value) == 0 || json.Unmarshal(value, &decoded) != nil {
		return nil, false
	}
	return decoded, true
}

func decodeLocation(value json.RawMessage) (models.RawLocation, bool) {
	object, ok := decodeObject(value)
	if !ok {
		return models.RawLocation{}, false
	}
	latitude, ok := decodeFloat(object["latitude"])
	if !ok {
		return models.RawLocation{}, false
	}
	longitude, ok := decodeFloat(object["longitude"])
	if !ok {
		return models.RawLocation{}, false
	}
	countryObject, ok := decodeObject(object["country"])
	if !ok {
		return models.RawLocation{}, false
	}
	country, ok := decodeString(countryObject["name"])
	if !ok {
		return models.RawLocation{}, false
	}
	cityObject, ok := decodeObject(countryObject["city"])
	if !ok {
		return models.RawLocation{}, false
	}
	city, ok := decodeString(cityObject["name"])
	if !ok {
		return models.RawLocation{}, false
	}

	return models.RawLocation{
		Latitude:  latitude,
		Longitude: longitude,
		Country: models.RawCountry{
			Name: country,
			City: models.RawCity{Name: city},
		},
	}, true
}

func decodeGroups(value json.RawMessage) []models.RawGroup {
	values, ok := decodeArray(value)
	if !ok {
		return nil
	}

	groups := make([]models.RawGroup, 0, len(values))
	for _, value := range values {
		object, ok := decodeObject(value)
		if !ok {
			continue
		}
		identifier, ok := decodeString(object["identifier"])
		if !ok {
			continue
		}
		groups = append(groups, models.RawGroup{Identifier: identifier})
	}
	return groups
}

func decodeTechnologies(value json.RawMessage) []models.RawTechnology {
	values, ok := decodeArray(value)
	if !ok {
		return nil
	}

	technologies := make([]models.RawTechnology, 0, len(values))
	for _, value := range values {
		object, ok := decodeObject(value)
		if !ok {
			continue
		}
		metadataValues, ok := decodeArray(object["metadata"])
		if !ok {
			continue
		}

		metadata := make([]models.RawMetadata, 0, len(metadataValues))
		for _, metadataValue := range metadataValues {
			metadataObject, ok := decodeObject(metadataValue)
			if !ok {
				continue
			}
			name, ok := decodeString(metadataObject["name"])
			if !ok {
				continue
			}
			value, ok := decodeString(metadataObject["value"])
			if !ok {
				continue
			}
			metadata = append(metadata, models.RawMetadata{
				Name:  name,
				Value: value,
			})
		}
		technologies = append(technologies, models.RawTechnology{Metadata: metadata})
	}
	return technologies
}

func (c *NordClient) getJSON(ctx context.Context, target string, headers http.Header, limit int64, destination any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", userAgent)
	for name, values := range headers {
		for _, value := range values {
			req.Header.Add(name, value)
		}
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("perform request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("%w: HTTP %d", ErrUnauthorized, resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected HTTP status %d", resp.StatusCode)
	}

	limitedBody := &io.LimitedReader{R: resp.Body, N: limit + 1}
	decoder := json.NewDecoder(limitedBody)
	if err := decoder.Decode(destination); err != nil {
		if limit+1-limitedBody.N > limit {
			return fmt.Errorf("response exceeded %d bytes", limit)
		}
		if errors.Is(err, io.EOF) {
			return fmt.Errorf("response body was empty")
		}
		return fmt.Errorf("decode response: %w", err)
	}
	if limit+1-limitedBody.N > limit {
		return fmt.Errorf("response exceeded %d bytes", limit)
	}

	var extra any
	err = decoder.Decode(&extra)
	if limit+1-limitedBody.N > limit {
		return fmt.Errorf("response exceeded %d bytes", limit)
	}
	if err == nil {
		return fmt.Errorf("response contained multiple JSON values")
	}
	if !errors.Is(err, io.EOF) {
		return fmt.Errorf("decode trailing response data: %w", err)
	}
	return nil
}
