SERVERS_URL = (
    "https://api.nordvpn.com/v1/servers?limit=16384"
    "&filters[servers_technologies][identifier]=wireguard_udp"
    "&fields[station]=1&fields[hostname]=1&fields[load]=1"
    "&fields[technologies.metadata]=1&fields[locations.country.name]=1"
    "&fields[locations.country.city.name]=1&fields[locations.latitude]=1"
    "&fields[locations.longitude]=1&fields[groups.identifier]=1"
)
GEO_URL = "https://api.nordvpn.com/v1/helpers/ips/insights"
CREDS_URL = "https://api.nordvpn.com/v1/users/services/credentials"

GROUP_STANDARD_ID = "legacy_standard"
GROUP_P2P_ID = "legacy_p2p"
GROUP_DEDICATED_ID = "legacy_dedicated_ip"
GROUP_ONION_ID = "legacy_onion_over_vpn"
GROUP_DOUBLE_ID = "legacy_double_vpn"

GROUP_ID_TO_ALIAS = {
    GROUP_STANDARD_ID: "standard",
    GROUP_P2P_ID: "p2p",
    GROUP_DEDICATED_ID: "dedicated",
    GROUP_ONION_ID: "onion",
    GROUP_DOUBLE_ID: "double",
}
ALIAS_TO_GROUP_ID = {alias: identifier for identifier, alias in GROUP_ID_TO_ALIAS.items()}
TYPE_GROUPS = frozenset(GROUP_ID_TO_ALIAS)
