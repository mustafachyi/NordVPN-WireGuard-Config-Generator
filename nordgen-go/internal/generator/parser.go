package generator

import (
	"math"
	"net/netip"
	"sort"
	"strings"

	"nordgen/internal/constants"
	"nordgen/internal/models"
	"nordgen/internal/wireguard"
)

const earthRadiusKM = 6371.0

func parseServers(rawServers []models.RawServer, observer *models.Coordinates, reqGroups []string, excludeDedicated, useIP bool) []models.Server {
	required := make(map[string]struct{}, len(reqGroups))
	for _, group := range reqGroups {
		required[group] = struct{}{}
	}

	var observerLatitudeRadians float64
	var observerLongitudeRadians float64
	var observerLatitudeCosine float64
	if observer != nil {
		observerLatitudeRadians = observer.Latitude * math.Pi / 180
		observerLongitudeRadians = observer.Longitude * math.Pi / 180
		observerLatitudeCosine = math.Cos(observerLatitudeRadians)
	}

	parsed := make([]models.Server, 0, len(rawServers))
	for _, raw := range rawServers {
		if raw.Load < 0 || raw.Load > 100 || len(raw.Locations) == 0 {
			continue
		}

		hostname := strings.ToLower(strings.TrimSpace(raw.Hostname))
		if err := wireguard.ValidateEndpoint(hostname); err != nil {
			continue
		}

		station := strings.TrimSpace(raw.Station)
		if useIP {
			address, err := netip.ParseAddr(station)
			if err != nil {
				continue
			}
			station = address.String()
		}

		groupSet := make(map[string]struct{}, len(raw.Groups))
		hasDedicated := false
		for _, group := range raw.Groups {
			identifier := group.Identifier
			if !constants.IsTypeGroup(identifier) {
				continue
			}
			groupSet[identifier] = struct{}{}
			if identifier == constants.GroupDedicatedID {
				hasDedicated = true
			}
		}
		if len(groupSet) == 0 || excludeDedicated && hasDedicated {
			continue
		}
		if !containsAllGroups(groupSet, required) {
			continue
		}

		groupIDs := make([]string, 0, len(groupSet))
		for identifier := range groupSet {
			groupIDs = append(groupIDs, identifier)
		}
		sort.Strings(groupIDs)
		comboParts := make([]string, len(groupIDs))
		for index, identifier := range groupIDs {
			comboParts[index], _ = constants.GroupAlias(identifier)
		}

		publicKey := findPublicKey(raw.Technologies)
		if err := wireguard.ValidateKey(publicKey); err != nil {
			continue
		}

		location := raw.Locations[0]
		if !validCoordinates(location.Latitude, location.Longitude) {
			continue
		}
		country := strings.TrimSpace(location.Country.Name)
		city := strings.TrimSpace(location.Country.City.Name)
		if country == "" || city == "" {
			continue
		}

		name := strings.SplitN(hostname, ".", 2)[0]
		if name == "" {
			continue
		}

		distance := 0.0
		if observer != nil {
			distance = calculateDistance(
				observerLatitudeRadians,
				observerLongitudeRadians,
				observerLatitudeCosine,
				location.Latitude,
				location.Longitude,
			)
		}

		parsed = append(parsed, models.Server{
			Name:      name,
			Hostname:  hostname,
			Station:   station,
			Load:      raw.Load,
			Country:   country,
			City:      city,
			PublicKey: publicKey,
			Distance:  distance,
			Combo:     strings.Join(comboParts, "_"),
		})
	}

	return parsed
}

func containsAllGroups(actual, required map[string]struct{}) bool {
	for group := range required {
		if _, exists := actual[group]; !exists {
			return false
		}
	}
	return true
}

func findPublicKey(technologies []models.RawTechnology) string {
	for _, technology := range technologies {
		for _, metadata := range technology.Metadata {
			if metadata.Name == "public_key" {
				if value := strings.TrimSpace(metadata.Value); value != "" {
					return value
				}
			}
		}
	}
	return ""
}

func validCoordinates(latitude, longitude float64) bool {
	return !math.IsNaN(latitude) && !math.IsNaN(longitude) &&
		!math.IsInf(latitude, 0) && !math.IsInf(longitude, 0) &&
		latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
}

func calculateDistance(observerLatitudeRadians, observerLongitudeRadians, observerLatitudeCosine, latitude, longitude float64) float64 {
	latitudeRadians := latitude * math.Pi / 180
	latitudeDelta := latitudeRadians - observerLatitudeRadians
	longitudeDelta := longitude*math.Pi/180 - observerLongitudeRadians

	latitudeSine := math.Sin(latitudeDelta / 2)
	longitudeSine := math.Sin(longitudeDelta / 2)
	a := latitudeSine*latitudeSine + observerLatitudeCosine*math.Cos(latitudeRadians)*longitudeSine*longitudeSine
	a = math.Max(0, math.Min(1, a))
	return earthRadiusKM * 2 * math.Asin(math.Sqrt(a))
}
