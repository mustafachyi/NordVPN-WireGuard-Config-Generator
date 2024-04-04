package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
)

var (
	mu          sync.Mutex
	bestConfigs = make(map[string]map[string]Server)
)

var serversByLocation = make(map[string]map[string]map[string]interface{})

type Server struct {
	Name         string `json:"name"`
	Station      string `json:"station"`
	Load         int    `json:"load"`
	Distance     float64
	Technologies []struct {
		Identifier string `json:"identifier"`
		Metadata   []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		} `json:"metadata"`
	} `json:"technologies"`
	Locations []struct {
		Country struct {
			Name string `json:"name"`
			City struct {
				Name string `json:"name"`
			} `json:"city"`
		} `json:"country"`
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	} `json:"locations"`
}

type Location struct {
	Loc string `json:"loc"`
}

func main() {
	// Prompt user for token
	reader := bufio.NewReader(os.Stdin)
	var privateKey string
	for {
		fmt.Print("Enter your token: ")
		token, _ := reader.ReadString('\n')
		token = strings.TrimSpace(token)

		// Get the Nordlynx private key
		fmt.Println("Getting Nordlynx private key...")
		privateKey = getPrivateKey(token)
		if privateKey == "" {
			fmt.Println("Failed to retrieve Nordlynx Private Key. The token might be incorrect.")
			continue
		}
		break
	}

	// Get user's location
	fmt.Println("Getting user's location...")
	loc := getLocation()
	lat, lon := parseLocation(loc.Loc)

	// Get servers
	fmt.Println("Getting servers...")
	servers := getServers()

	// Sort servers
	fmt.Println("Sorting servers...")
	sortServers(servers, lat, lon)

	// Save configs
	fmt.Println("Saving configs...")
	var wg sync.WaitGroup
	for _, server := range servers {
		wg.Add(1)
		go func(server Server) {
			defer wg.Done()
			saveConfig(privateKey, server)
		}(server)
	}
	wg.Wait()

	// Save best configs
	fmt.Println("Saving best configs...")
	for country, cities := range bestConfigs {
		for city, server := range cities {
			dir := filepath.Join("best_configs", fmt.Sprintf("%s_%s.conf", country, city))
			saveConfig(privateKey, server, dir)
		}
	}

	fmt.Println("Formatting JSON output...")
	b, err := json.MarshalIndent(serversByLocation, "", "  ")
	if err != nil {
		fmt.Println("Failed to marshal JSON:", err)
		return
	}
	// Convert bytes to string
	s := string(b)
	// Remove newlines after commas in arrays
	s = strings.Replace(s, ",\n        ", ",", -1)
	// Remove newlines before closing brackets in arrays
	s = strings.Replace(s, "\n        ]", "]", -1)
	// Add newline before opening brackets in arrays
	s = strings.Replace(s, "[\n        ", "[", -1)
	// Convert string back to bytes
	b = []byte(s)
	if err := os.WriteFile("servers.json", b, 0644); err != nil {
		fmt.Println(err)
		return
	}
}

func getLocation() Location {
	resp, err := http.Get("https://ipinfo.io/json")
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	var loc Location
	if err := json.NewDecoder(resp.Body).Decode(&loc); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}

	return loc
}

func parseLocation(loc string) (float64, float64) {
	parts := strings.Split(loc, ",")
	lat, _ := strconv.ParseFloat(parts[0], 64)
	lon, _ := strconv.ParseFloat(parts[1], 64)
	return lat, lon
}

func getServers() []Server {
	resp, err := http.Get("https://api.nordvpn.com/v1/servers?limit=7000&filters[servers_technologies][identifier]=wireguard_udp")
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	var servers []Server
	if err := json.NewDecoder(resp.Body).Decode(&servers); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}

	return servers
}

func sortServers(servers []Server, lat, lon float64) {
	for i := range servers {
		servers[i].Distance = haversine(lat, lon, servers[i].Locations[0].Latitude, servers[i].Locations[0].Longitude)
	}
	sort.Slice(servers, func(i, j int) bool {
		if servers[i].Load == servers[j].Load {
			return servers[i].Distance < servers[j].Distance
		}
		return servers[i].Load < servers[j].Load
	})
}

func saveConfig(privateKey string, server Server, filename ...string) {
	publicKey := findPublicKey(server)

	if publicKey == "" {
		fmt.Printf("No WireGuard public key found for %s. Skipping.\n", server.Name)
		return
	}

	config := fmt.Sprintf(`
[Interface]
PrivateKey = %s
Address = 10.5.0.2/16
DNS = 103.86.96.100

[Peer]
PublicKey = %s
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = %s:51820
PersistentKeepalive = 25
`, privateKey, publicKey, server.Station)

	// Create configs, country, and city directories
	country := strings.ReplaceAll(server.Locations[0].Country.Name, " ", "_")
	city := strings.ReplaceAll(server.Locations[0].Country.City.Name, " ", "_")
	dir := fmt.Sprintf("configs/%s/%s", country, city)
	if err := os.MkdirAll(dir, 0755); err != nil {
		fmt.Println(err)
		return
	}

	// Clean up the server name
	serverName := strings.ReplaceAll(server.Name, "#", "")
	serverName = strings.ReplaceAll(serverName, " ", "_")

	// Save the config file in the configs/country/city directory
	var err error
	if len(filename) > 0 {
		dir := filepath.Dir(filename[0])
		if err := os.MkdirAll(dir, 0755); err != nil {
			fmt.Println(err)
			return
		}
		err = os.WriteFile(filename[0], []byte(config), 0644)
	} else {
		filename := fmt.Sprintf("%s/%s.conf", dir, serverName)
		err = os.WriteFile(filename, []byte(config), 0644)
	}
	if err != nil {
		fmt.Println(err)
	}

	// Update the best config for the country and city
	mu.Lock()
	defer mu.Unlock()
	if _, ok := bestConfigs[country]; !ok {
		bestConfigs[country] = make(map[string]Server)
	}
	if _, ok := bestConfigs[country][city]; !ok || server.Load < bestConfigs[country][city].Load {
		bestConfigs[country][city] = server
	}

	// Update the serversByLocation map
	if _, ok := serversByLocation[country]; !ok {
		serversByLocation[country] = make(map[string]map[string]interface{})
	}
	if _, ok := serversByLocation[country][city]; !ok {
		serversByLocation[country][city] = make(map[string]interface{})
		serversByLocation[country][city]["distance"] = math.Round(server.Distance)
		serversByLocation[country][city]["servers"] = make([][]interface{}, 0)
	}
	serversByLocation[country][city]["servers"] = append(serversByLocation[country][city]["servers"].([][]interface{}), []interface{}{server.Name, server.Load})
}

func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371 // Radius of the Earth in kilometers
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLon/2)*math.Sin(dLon/2)

	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

func findPublicKey(server Server) string {
	for _, tech := range server.Technologies {
		if tech.Identifier == "wireguard_udp" {
			for _, data := range tech.Metadata {
				if data.Name == "public_key" {
					return data.Value
				}
			}
		}
	}
	return ""
}

type Credentials struct {
	NordlynxPrivateKey string `json:"nordlynx_private_key"`
}

func getPrivateKey(token string) string {
	req, err := http.NewRequest("GET", "https://api.nordvpn.com/v1/users/services/credentials", nil)
	if err != nil {
		fmt.Println(err)
		return ""
	}
	req.SetBasicAuth("token", token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fmt.Println(err)
		return ""
	}
	defer resp.Body.Close()

	var data Credentials
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		fmt.Println(err)
		return ""
	}

	return data.NordlynxPrivateKey
}
