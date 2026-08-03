package models

import (
	"fmt"
	"net/netip"
	"strings"
)

const MaxKeepalive = 65535

type Coordinates struct {
	Latitude  float64
	Longitude float64
}

type Server struct {
	Name      string
	Hostname  string
	Station   string
	Load      int
	Country   string
	City      string
	PublicKey string
	Distance  float64
	Combo     string
}

type UserPreferences struct {
	DNS              string
	UseIP            bool
	Keepalive        int
	Groups           []string
	ExcludeDedicated bool
}

func (p UserPreferences) Validate() error {
	if _, err := netip.ParseAddr(strings.TrimSpace(p.DNS)); err != nil {
		return fmt.Errorf("DNS must be a valid IPv4 or IPv6 address")
	}
	if p.Keepalive < 0 || p.Keepalive > MaxKeepalive {
		return fmt.Errorf("keepalive must be between 0 and %d seconds", MaxKeepalive)
	}
	return nil
}

type GenerationStats struct {
	Total int
	Best  int
}

type RawServer struct {
	Hostname     string          `json:"hostname"`
	Station      string          `json:"station"`
	Load         int             `json:"load"`
	Locations    []RawLocation   `json:"locations"`
	Groups       []RawGroup      `json:"groups"`
	Technologies []RawTechnology `json:"technologies"`
}

type RawLocation struct {
	Latitude  float64    `json:"latitude"`
	Longitude float64    `json:"longitude"`
	Country   RawCountry `json:"country"`
}

type RawCountry struct {
	Name string  `json:"name"`
	City RawCity `json:"city"`
}

type RawCity struct {
	Name string `json:"name"`
}

type RawGroup struct {
	Identifier string `json:"identifier"`
}

type RawTechnology struct {
	Metadata []RawMetadata `json:"metadata"`
}

type RawMetadata struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}
