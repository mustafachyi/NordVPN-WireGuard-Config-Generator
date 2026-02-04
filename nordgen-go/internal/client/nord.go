package client

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/mustafachyi/nordvpn-wireguard-config-generator/internal/structs"
)

const (
	BaseURL = "https://api.nordvpn.com/v1"
	GeoURL  = "https://api.nordvpn.com/v1/helpers/ips/insights"
)

type Nord struct {
	http *http.Client
}

type credentialsResponse struct {
	Key string `json:"nordlynx_private_key"`
}

type geoResponse struct {
	Lat float64 `json:"latitude"`
	Lon float64 `json:"longitude"`
}

func New() *Nord {
	return &Nord{
		http: &http.Client{
			Timeout: 20 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:       10,
				IdleConnTimeout:    30 * time.Second,
				DisableCompression: false,
			},
		},
	}
}

func (c *Nord) GetPrivateKey(token string) (string, error) {
	auth := base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("token:%s", token)))
	req, err := http.NewRequest("GET", fmt.Sprintf("%s/users/services/credentials", BaseURL), nil)
	if err != nil {
		return "", err
	}
	req.Header.Add("Authorization", fmt.Sprintf("Basic %s", auth))

	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("api status: %d", resp.StatusCode)
	}

	var res credentialsResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return "", err
	}

	if res.Key == "" {
		return "", fmt.Errorf("missing private key")
	}
	return res.Key, nil
}

func (c *Nord) FetchServers() ([]structs.ApiServer, error) {
	url := fmt.Sprintf("%s/servers?limit=16384&filters[servers_technologies][identifier]=wireguard_udp", BaseURL)
	resp, err := c.http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server fetch status: %d", resp.StatusCode)
	}

	var servers []structs.ApiServer
	if err := json.NewDecoder(resp.Body).Decode(&servers); err != nil {
		return nil, err
	}
	return servers, nil
}

func (c *Nord) FetchGeo() (float64, float64, error) {
	resp, err := c.http.Get(GeoURL)
	if err != nil {
		return 0, 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, 0, fmt.Errorf("geo api status: %d", resp.StatusCode)
	}

	var geo geoResponse
	if err := json.NewDecoder(resp.Body).Decode(&geo); err != nil {
		return 0, 0, err
	}

	return geo.Lat, geo.Lon, nil
}
