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
	var servers []models.RawServer
	if err := c.getJSON(ctx, c.endpoints.servers, nil, serversResponseLimit, &servers); err != nil {
		return nil, fmt.Errorf("get servers: %w", err)
	}
	if len(servers) == 0 {
		return nil, fmt.Errorf("server response was empty")
	}
	return servers, nil
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
