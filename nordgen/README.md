# NordVPN WireGuard Config Generator

NordGen is a Python command-line application that creates WireGuard configuration files from the current NordVPN server catalogue.

It can:

- Exchange a NordVPN access token for a NordLynx private key.
- Generate configurations for valid WireGuard-enabled servers.
- Filter servers by supported group.
- Use hostnames or IP addresses as endpoints.
- Select a best-ranked server for each group, country, and city.
- Run interactively or through explicit command-line options.

## Requirements

- Python 3.11 or later
- An active NordVPN subscription
- A 64-character NordVPN access token

Access tokens can be created from the [Nord Account dashboard](https://my.nordaccount.com/dashboard/nordvpn/access-tokens/).

## Installation

Install with `pipx`:

````bash
pipx install nord-config-generator
````

Install with `pip`:

````bash
pip install nord-config-generator
````

## Commands

Generate configurations:

````bash
nordgen
````

Use the explicit generation command:

````bash
nordgen generate
````

Retrieve only the NordLynx private key:

````bash
nordgen get-key
````

Display help:

````bash
nordgen help
````

````bash
nordgen --help
````

## Interactive Behavior

Running `nordgen` without generation options prompts for:

- NordVPN access token
- DNS address
- Endpoint type
- Keepalive value
- Dedicated IP exclusion

Server groups are not prompted interactively. Use `--group` when group filtering is required.

Once any generation option is provided, unspecified generation preferences use their default values instead of being prompted.

The token is still prompted for when `--token` is omitted.

For example, this prompts only for the token:

````bash
nordgen --exclude-dedicated
````

## Generation Options

| Option | Description | Default |
|---|---|---|
| `-t`, `--token` | NordVPN access token containing exactly 64 hexadecimal characters | Prompted |
| `-d`, `--dns` | IPv4 or IPv6 DNS address written to each configuration | `103.86.96.100` |
| `-i`, `--ip` | Use the server IP address instead of its hostname | Disabled |
| `-k`, `--keepalive` | `PersistentKeepalive` value from 0 to 65535 seconds | `25` |
| `-g`, `--group` | Required groups: `standard`, `p2p`, `dedicated`, `onion`, or `double` | No group filter |
| `-e`, `--exclude-dedicated` | Exclude servers marked as Dedicated IP | Disabled |

## Group Filtering

The group option can be repeated:

````bash
nordgen --group standard --group p2p
````

It can also receive several values:

````bash
nordgen --group standard p2p
````

Group filters use all-match behavior.

The previous example includes servers that belong to both the Standard and P2P groups. It does not combine Standard-only and P2P-only servers into one result.

Duplicate group values are ignored during command-line parsing.

The Dedicated IP group cannot be required while `--exclude-dedicated` is enabled.

## Examples

Generate using default preferences and an explicit token:

````bash
nordgen --token <YOUR_TOKEN>
````

Use Cloudflare DNS and a 15-second keepalive:

````bash
nordgen --dns 1.1.1.1 --keepalive 15
````

Generate Standard servers and exclude any server also marked as Dedicated IP:

````bash
nordgen --group standard --exclude-dedicated
````

Use server IP addresses as WireGuard endpoints:

````bash
nordgen --ip
````

Retrieve the private key with an explicit token:

````bash
nordgen get-key --token <YOUR_TOKEN>
````

## Server Processing

NordGen fetches the server catalogue and geolocation concurrently.

Each server record is checked before use. Invalid records are skipped, including records with:

- Invalid hostnames
- Invalid WireGuard public keys
- Invalid coordinates
- Invalid load values
- Missing location data
- No recognized server group
- Invalid IP addresses when IP endpoints are requested

Duplicate hostnames are removed after ranking. The highest-ranked record for each hostname is retained.

A geolocation failure does not stop generation. When location is unavailable, equal-load servers are ordered by stable server fields instead of distance.

## Ranking

Servers are ordered by:

1. Current load
2. Geographic distance
3. Hostname
4. Group combination
5. Country
6. City
7. Station address
8. Public key

Load always has priority over distance.

The `best_configs/` tree contains the first ranked server for each unique combination of:

- Group combination
- Country
- City

## Output

Each successful run creates a directory in the current working directory:

````text
nordvpn_configs_YYYYMMDD_HHMMSS_NNNNNNNNN/
├── configs/
│   └── <group_combination>/
│       └── <country>/
│           └── <city>/
│               └── <server>.conf
└── best_configs/
    └── <group_combination>/
        └── <country>/
            └── <city>/
                └── <server>.conf
````

The final nine digits represent nanoseconds.

The `configs/` tree contains every valid matching server after hostname deduplication.

The `best_configs/` tree contains the selected server for each group, country, and city.

Names are normalized for filesystem compatibility. Invalid path characters are replaced, reserved Windows names are prefixed, long names are shortened, and collisions receive numeric suffixes.

Examples of collision handling include:

````text
server.conf
server_1.conf
server_2.conf
````

## Configuration Format

Generated files follow this structure:

````ini
[Interface]
PrivateKey = <private-key>
Address = 10.5.0.2/16
DNS = 103.86.96.100

[Peer]
PublicKey = <server-public-key>
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = <server>:51820
PersistentKeepalive = 25
````

IPv6 endpoints are enclosed in brackets automatically:

````ini
Endpoint = [2001:db8::1]:51820
````

## File Handling

Files are written into a temporary directory under the selected working directory.

The completed directory is renamed to its final name only after all configuration files have been written successfully.

NordGen does not overwrite:

- Existing configuration files
- An existing final output directory

Temporary output is removed when generation fails before completion.

On POSIX systems:

- Output directories request mode `0700`.
- Configuration files request mode `0600`.

The operating-system umask may make those permissions more restrictive.

On Windows, the output root receives a protected access-control list for the current user, with inheritance enabled for generated contents.

## Dedicated IP Servers

Dedicated IP servers require the corresponding NordVPN service on the account.

The public server catalogue may contain Dedicated IP entries that the current account cannot use. NordGen can still generate their configuration files because catalogue access and account authorization are separate operations.

Exclude them with:

````bash
nordgen --exclude-dedicated
````

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Operation completed successfully |
| `1` | Runtime, network, validation, filesystem, or output failure |
| `2` | Invalid command or command-line arguments |
| `130` | Operation cancelled |

## Security

Generated configurations contain the NordLynx private key.

The application does not intentionally save the NordVPN access token to generated output.

Interactive token input is hidden or masked when standard input is an interactive terminal. Input supplied through pipes, redirected files, or other non-terminal streams is not masked.

A token passed through `--token` may appear in shell history, process listings, or automation logs.

The `get-key` command writes the private key to standard output. Avoid redirecting it to an unsecured file or log.

Credentials remain in normal process memory while required. The application does not claim to securely erase them before exit.

## Links

- [Source repository](https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator)
- [Issue tracker](https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator/issues)

## License

Distributed under the GNU General Public License version 3 or later. See [`LICENSE`](LICENSE).