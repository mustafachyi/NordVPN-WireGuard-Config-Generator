package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Server represents a VPN server.
type Server struct {
	Name      string
	Hostname  string
	Station   string
	Load      int
	Country   string
	City      string
	Latitude  float64
	Longitude float64
	PublicKey string
	Distance  float64
}

// UserConfig holds user preferences.
type UserConfig struct {
	DNS        string
	UseIP      bool
	Keepalive  int
}

// NordVPNConfigGenerator handles configuration generation.
type NordVPNConfigGenerator struct {
	ConcurrentLimit int
	OutputDir       string
	UserConfig      UserConfig
	Logger          *log.Logger
	mu              sync.Mutex
}

func main() {
	logger := log.New(os.Stdout, "", log.LstdFlags)
	logger.Println("NordVPN Configuration Generator")
	logger.Println("==============================")

	token, err := promptToken(logger)
	if err != nil {
		logger.Println("Operation cancelled by user. Exiting...")
		os.Exit(0)
	}

	logger.Println("Validating access token...")
	privateKey, err := validateToken(token)
	if err != nil {
		logger.Println("Invalid token or API error. Could not retrieve private key.")
		return
	}
	logger.Println("Token validated successfully!")

	userConfig, err := getUserPreferences(logger)
	if err != nil {
		logger.Println("Operation cancelled by user. Exiting...")
		os.Exit(0)
	}

	startTime := time.Now()
	generator := NordVPNConfigGenerator{
		ConcurrentLimit: 200,
		UserConfig:      userConfig,
		Logger:          logger,
	}
	err = generator.GenerateConfigs(token, privateKey)
	if err != nil {
		logger.Printf("Process failed - %v", err)
		return
	}
	elapsedTime := time.Since(startTime).Seconds()

	if generator.OutputDir != "" {
		logger.Printf("Process completed in %.2f seconds", elapsedTime)
	} else {
		logger.Println("Process failed - no configurations were generated")
	}
}

// clearConsole clears the terminal screen for a cleaner interface.
func clearConsole() {
	cmd := exec.Command("clear") // Use "cls" for Windows
	cmd.Stdout = os.Stdout
	cmd.Run()
}

func promptToken(logger *log.Logger) (string, error) {
	reader := bufio.NewReader(os.Stdin)
	for {
		clearConsole()
		fmt.Print("Please enter your access token (64-character hex string): ")
		token, err := reader.ReadString('\n')
		if err != nil {
			return "", err
		}
		token = strings.TrimSpace(token)
		if validToken(token) {
			return token, nil
		}
		logger.Println("Invalid token format. Ensure it's a 64-character hexadecimal string.")
		fmt.Print("Press Enter to try again...")
		_, _ = reader.ReadString('\n') // Wait for user to press Enter
	}
}

func validToken(token string) bool {
	match, _ := regexp.MatchString("^[a-fA-F0-9]{64}$", token)
	return match
}

func validateToken(token string) (string, error) {
	tokenEncoded := base64.StdEncoding.EncodeToString([]byte("token:" + token))
	req, err := http.NewRequest("GET", "https://api.nordvpn.com/v1/users/services/credentials", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Basic "+tokenEncoded)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("API error: %s", resp.Status)
	}

	var data struct {
		NordlynxPrivateKey string `json:"nordlynx_private_key"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}

	if data.NordlynxPrivateKey == "" {
		return "", fmt.Errorf("private key not found")
	}
	return data.NordlynxPrivateKey, nil
}

func getUserPreferences(logger *log.Logger) (UserConfig, error) {
	reader := bufio.NewReader(os.Stdin)

	clearConsole()
	fmt.Print("Enter DNS server IP [default: 103.86.96.100]: ")
	dns, err := reader.ReadString('\n')
	if err != nil {
		return UserConfig{}, err
	}
	dns = strings.TrimSpace(dns)
	if dns == "" {
		dns = "103.86.96.100"
	} else if !isValidIP(dns) {
		logger.Println("Please enter a valid IP address.")
		fmt.Print("Press Enter to try again...")
		_, _ = reader.ReadString('\n') // Wait for user to press Enter
		return getUserPreferences(logger)
	}

	var useIP bool
	for {
		fmt.Print("Use IP instead of hostname for endpoints? (yes/no) [default: no]: ")
		input, err := reader.ReadString('\n')
		if err != nil {
			return UserConfig{}, err
		}
		input = strings.ToLower(strings.TrimSpace(input))
		if input == "yes" {
			useIP = true
			break
		} else if input == "no" || input == "" {
			useIP = false
			break
		} else {
			logger.Println("Please enter 'yes' or 'no'.")
			fmt.Print("Press Enter to try again...")
			_, _ = reader.ReadString('\n') // Wait for user to press Enter
		}
	}

	var keepalive int
	for {
		fmt.Print("Enter PersistentKeepalive value [15-120, default: 25]: ")
		input, err := reader.ReadString('\n')
		if err != nil {
			return UserConfig{}, err
		}
		input = strings.TrimSpace(input)
		if input == "" {
			keepalive = 25
			break
		}
		value, err := strconv.Atoi(input)
		if err != nil || value < 15 || value > 120 {
			logger.Println("Keepalive must be between 15 and 120.")
			fmt.Print("Press Enter to try again...")
			_, _ = reader.ReadString('\n') // Wait for user to press Enter
			continue
		}
		keepalive = value
		break
	}

	return UserConfig{
		DNS:       dns,
		UseIP:     useIP,
		Keepalive: keepalive,
	}, nil
}

func isValidIP(ip string) bool {
	match, _ := regexp.MatchString(`^(\d{1,3}\.){3}\d{1,3}$`, ip)
	return match
}

func (gen *NordVPNConfigGenerator) GenerateConfigs(token, privateKey string) error {
	gen.Logger.Println("Starting configuration generation...")

	servers, err := gen.getServers()
	if err != nil {
		gen.Logger.Println("Failed to get servers")
		return err
	}
	gen.Logger.Printf("Found %d servers", len(servers))

	location, err := gen.getLocation()
	if err != nil {
		gen.Logger.Println("Failed to get location")
		return err
	}
	gen.Logger.Printf("Current location: %v", location)

	if err := gen.initializeOutputDirectory(); err != nil {
		return err
	}

	parsedServers := parseServers(servers, location)
	gen.Logger.Printf("Successfully processed %d servers", len(parsedServers))

	sortedServers := sortServers(parsedServers)

	gen.Logger.Println("Generating standard configurations...")
	if err := gen.processAndSave(privateKey, sortedServers, "configs"); err != nil {
		return err
	}

	gen.Logger.Println("Generating optimized configurations...")
	bestServers := selectBestServers(sortedServers)
	if err := gen.processAndSave(privateKey, bestServers, "best_configs"); err != nil {
		return err
	}

	gen.Logger.Println("Saving server information...")
	if err := gen.saveServerInfo(sortedServers); err != nil {
		return err
	}

	gen.Logger.Printf("All configurations have been saved to: %s", gen.OutputDir)
	return nil
}

func (gen *NordVPNConfigGenerator) initializeOutputDirectory() error {
	timestamp := time.Now().Format("2006-01-02_15_04_05")
	gen.OutputDir = filepath.Join(".", fmt.Sprintf("nordvpn_configs_%s", timestamp))
	err := os.MkdirAll(gen.OutputDir, os.ModePerm)
	if err != nil {
		return err
	}
	gen.Logger.Printf("Created output directory: %s", gen.OutputDir)
	return nil
}

func (gen *NordVPNConfigGenerator) getServers() ([]map[string]interface{}, error) {
	req, err := http.NewRequest("GET", "https://api.nordvpn.com/v1/servers", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Add("limit", "7000")
	q.Add("filters[servers_technologies][identifier]", "wireguard_udp")
	req.URL.RawQuery = q.Encode()

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error: %s", resp.Status)
	}

	var servers []map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&servers); err != nil {
		return nil, err
	}
	return servers, nil
}

func (gen *NordVPNConfigGenerator) getLocation() ([]float64, error) {
	resp, err := http.Get("https://ipinfo.io/json")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Location API error: %s", resp.Status)
	}

	var data struct {
		Loc string `json:"loc"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	parts := strings.Split(data.Loc, ",")
	if len(parts) != 2 {
		return nil, fmt.Errorf("Invalid location format")
	}

	var lat, lon float64
	if _, err := fmt.Sscanf(parts[0], "%f", &lat); err != nil {
		return nil, err
	}
	if _, err := fmt.Sscanf(parts[1], "%f", &lon); err != nil {
		return nil, err
	}

	return []float64{lat, lon}, nil
}

func parseServers(servers []map[string]interface{}, userLocation []float64) []Server {
	var parsed []Server
	for _, serverData := range servers {
		server, err := parseServer(serverData, userLocation)
		if err != nil {
			continue
		}
		parsed = append(parsed, server)
	}
	return parsed
}

func parseServer(serverData map[string]interface{}, userLocation []float64) (Server, error) {
	try := func() (Server, error) {
		name, _ := serverData["name"].(string)
		hostname, _ := serverData["hostname"].(string)
		station, _ := serverData["station"].(string)
		loadFloat, _ := serverData["load"].(float64)
		load := int(loadFloat)

		locations, _ := serverData["locations"].([]interface{})
		if len(locations) == 0 {
			return Server{}, fmt.Errorf("no location")
		}
		locationMap, _ := locations[0].(map[string]interface{})

		countryMap, _ := locationMap["country"].(map[string]interface{})
		countryName, _ := countryMap["name"].(string)
		cityMap, _ := countryMap["city"].(map[string]interface{})
		cityName, _ := cityMap["name"].(string)
		if cityName == "" {
			cityName = "unknown"
		}

		latitude, _ := locationMap["latitude"].(float64)
		longitude, _ := locationMap["longitude"].(float64)

		technologies, _ := serverData["technologies"].([]interface{})
		var publicKey string
		for _, tech := range technologies {
			techMap, _ := tech.(map[string]interface{})
			if techMap["identifier"].(string) == "wireguard_udp" {
				metadata, _ := techMap["metadata"].([]interface{})
				for _, meta := range metadata {
					metaMap, _ := meta.(map[string]interface{})
					if metaMap["name"].(string) == "public_key" {
						publicKey = metaMap["value"].(string)
						break
					}
				}
				break
			}
		}

		if publicKey == "" {
			return Server{}, fmt.Errorf("no public key")
		}

		distance := calculateDistance(
			userLocation[0], userLocation[1],
			latitude, longitude,
		)

		return Server{
			Name:      name,
			Hostname:  hostname,
			Station:   station,
			Load:      load,
			Country:   countryName,
			City:      cityName,
			Latitude:  latitude,
			Longitude: longitude,
			PublicKey: publicKey,
			Distance:  distance,
		}, nil
	}

	server, err := try()
	return server, err
}

func calculateDistance(ulat, ulon, slat, slon float64) float64 {
	toRadians := func(degrees float64) float64 {
		return degrees * (math.Pi / 180)
	}
	dlon := toRadians(slon - ulon)
	dlat := toRadians(slat - ulat)
	a := math.Sin(dlat/2)*math.Sin(dlat/2) +
		math.Cos(toRadians(ulat))*math.Cos(toRadians(slat))*
			math.Sin(dlon/2)*math.Sin(dlon/2)
	c := 2 * math.Asin(math.Sqrt(a))
	return c * 6371 // Radius of Earth in kilometers
}

func sortServers(servers []Server) []Server {
	sorted := make([]Server, len(servers))
	copy(sorted, servers)
	// Simple bubble sort for demonstration; consider using sort.Slice for efficiency
	for i := 0; i < len(sorted); i++ {
		for j := 0; j < len(sorted)-i-1; j++ {
			if sorted[j].Load > sorted[j+1].Load || 
				(sorted[j].Load == sorted[j+1].Load && sorted[j].Distance > sorted[j+1].Distance) {
				sorted[j], sorted[j+1] = sorted[j+1], sorted[j]
			}
		}
	}
	return sorted
}

func (gen *NordVPNConfigGenerator) processAndSave(privateKey string, servers []Server, basePath string) error {
	var wg sync.WaitGroup
	sem := make(chan struct{}, gen.ConcurrentLimit)
	for _, server := range servers {
		wg.Add(1)
		sem <- struct{}{}
		go func(s Server) {
			defer wg.Done()
			defer func() { <-sem }()
			err := gen.saveConfig(privateKey, s, basePath)
			if err != nil {
				gen.Logger.Printf("Error saving config for %s: %v", s.Name, err)
			}
		}(server)
	}
	wg.Wait()
	return nil
}

func (gen *NordVPNConfigGenerator) saveConfig(key string, server Server, basePath string) error {
	config := generateConfig(key, server, gen.UserConfig)
	country := sanitizeName(server.Country)
	city := sanitizeName(server.City)
	name := sanitizeName(server.Name)

	dirPath := filepath.Join(gen.OutputDir, basePath, country, city)
	err := os.MkdirAll(dirPath, os.ModePerm)
	if err != nil {
		return err
	}

	filePath := filepath.Join(dirPath, fmt.Sprintf("%s.conf", name))
	return ioutil.WriteFile(filePath, []byte(config), 0644)
}

func generateConfig(key string, server Server, config UserConfig) string {
	endpoint := server.Station
	if config.UseIP {
		endpoint = server.Station // Placeholder: Replace with IP if available
	}
	return fmt.Sprintf(`[Interface]
PrivateKey = %s
Address = 10.5.0.2/16
DNS = %s

[Peer]
PublicKey = %s
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = %s:51820
PersistentKeepalive = %d`, key, config.DNS, server.PublicKey, endpoint, config.Keepalive)
}

func sanitizeName(name string) string {
	sanitized := strings.ToLower(name)
	sanitized = regexp.MustCompile(`\s+`).ReplaceAllString(sanitized, "_")
	sanitized = regexp.MustCompile(`(\d+)`).ReplaceAllString(sanitized, "_$1")
	sanitized = regexp.MustCompile(`and`).ReplaceAllString(sanitized, "_and_")
	sanitized = regexp.MustCompile(`_{2,}`).ReplaceAllString(sanitized, "_")
	sanitized = regexp.MustCompile(`[^a-z0-9_]`).ReplaceAllString(sanitized, "_")
	return strings.Trim(sanitized, "_")
}

func (gen *NordVPNConfigGenerator) saveServerInfo(servers []Server) error {
	serversInfo := make(map[string]map[string]struct {
		Distance int        `json:"distance"`
		Servers  [][]interface{} `json:"servers"`
	})

	for _, server := range servers {
		if _, ok := serversInfo[server.Country]; !ok {
			serversInfo[server.Country] = make(map[string]struct {
				Distance int        `json:"distance"`
				Servers  [][]interface{} `json:"servers"`
			})
		}
		cityInfo := serversInfo[server.Country][server.City]
		cityInfo.Distance = int(math.Round(server.Distance))
		cityInfo.Servers = append(cityInfo.Servers, []interface{}{server.Name, server.Load})
		serversInfo[server.Country][server.City] = cityInfo
	}

	data, err := json.MarshalIndent(serversInfo, "", "  ")
	if err != nil {
		return err
	}

	serversJsonPath := filepath.Join(gen.OutputDir, "servers.json")
	return ioutil.WriteFile(serversJsonPath, data, 0644)
}

func parseServersToBest(servers []Server) []Server {
	bestServersMap := make(map[string]Server)
	for _, server := range servers {
		key := fmt.Sprintf("%s_%s", server.Country, server.City)
		if existing, exists := bestServersMap[key]; !exists || server.Load < existing.Load {
			bestServersMap[key] = server
		}
	}
	var bestServers []Server
	for _, server := range bestServersMap {
		bestServers = append(bestServers, server)
	}
	return bestServers
}

func selectBestServers(servers []Server) []Server {
	bestServersMap := make(map[string]Server)
	for _, server := range servers {
		key := fmt.Sprintf("%s_%s", server.Country, server.City)
		if existing, exists := bestServersMap[key]; !exists || server.Load < existing.Load {
			bestServersMap[key] = server
		}
	}
	var bestServers []Server
	for _, server := range bestServersMap {
		bestServers = append(bestServers, server)
	}
	return bestServers
}
