package constants

const (
	ServersURL = "https://api.nordvpn.com/v1/servers?limit=16384&filters[servers_technologies][identifier]=wireguard_udp&fields[station]=1&fields[hostname]=1&fields[load]=1&fields[technologies.metadata]=1&fields[locations.country.name]=1&fields[locations.country.city.name]=1&fields[locations.latitude]=1&fields[locations.longitude]=1&fields[groups.identifier]=1"
	GeoURL     = "https://api.nordvpn.com/v1/helpers/ips/insights"
	CredsURL   = "https://api.nordvpn.com/v1/users/services/credentials"

	GroupStandardID  = "legacy_standard"
	GroupP2PID       = "legacy_p2p"
	GroupDedicatedID = "legacy_dedicated_ip"
	GroupOnionID     = "legacy_onion_over_vpn"
	GroupDoubleID    = "legacy_double_vpn"
)

var groupIDToAlias = map[string]string{
	GroupStandardID:  "standard",
	GroupP2PID:       "p2p",
	GroupDedicatedID: "dedicated",
	GroupOnionID:     "onion",
	GroupDoubleID:    "double",
}

var aliasToGroupID = map[string]string{
	"standard":  GroupStandardID,
	"p2p":       GroupP2PID,
	"dedicated": GroupDedicatedID,
	"onion":     GroupOnionID,
	"double":    GroupDoubleID,
}

func IsTypeGroup(identifier string) bool {
	_, exists := groupIDToAlias[identifier]
	return exists
}

func GroupAlias(identifier string) (string, bool) {
	alias, exists := groupIDToAlias[identifier]
	return alias, exists
}

func GroupID(alias string) (string, bool) {
	identifier, exists := aliasToGroupID[alias]
	return identifier, exists
}
