# NordVPN WireGuard Config Generator

A fast, asynchronous command-line tool that fetches the live NordVPN server catalogue and generates ready to use WireGuard configuration files one per server, organized by country and city, with the lowest-latency endpoint per location surfaced into a separate `best_configs/` tree.

## Features

- **Complete catalogue** generates a `.conf` for every WireGuard-enabled NordVPN server (typically ~7,500 active configurations).
- **Optimized subset** selects the lowest-load server per city into `best_configs/` for quick selection.
- **Distance-aware** ranks servers by load and Haversine distance from your detected geolocation.
- **Concurrent I/O** non-blocking HTTP and batched filesystem writes; full run completes in seconds.
- **Zero stored credentials** your access token is used in-memory only and is never written to disk.
- **Customizable** DNS, endpoint mode (hostname or IP), and keepalive interval are configurable per run.

## Requirements

- Python 3.11 or later
- An active NordVPN subscription and a [personal access token](https://my.nordaccount.com/dashboard/nordvpn/access-tokens/)

## Installation

The recommended installer for command-line applications is [`pipx`](https://pipx.pypa.io/), which isolates the tool in its own environment:

```bash
pipx install nord-config-generator
```

Plain `pip` works equally well:

```bash
pip install nord-config-generator
```

## Usage

### Generate configurations

Interactive mode prompts for token and preferences:

```bash
nordgen generate
```

Non interactive mode fully scripted:

```bash
nordgen generate --token <YOUR_TOKEN> --dns 103.86.96.100 --keepalive 25
```

| Flag | Description | Default |
|---|---|---|
| `-t`, `--token` | NordVPN access token (64-character hex) | prompted |
| `-d`, `--dns` | DNS server written into each config | `103.86.96.100` |
| `-i`, `--ip` | Use IP address instead of hostname for `Endpoint` | hostname |
| `-k`, `--keepalive` | `PersistentKeepalive` value in seconds | `25` |

### Retrieve the NordLynx private key

If you only need the raw private key for manual use:

```bash
nordgen get-key
```

## Output

Each run creates a timestamped directory in the current working directory:

```
nordvpn_configs_20260419_143022/
├── configs/
│   └── <country>/<city>/<countrycode><id>.conf
└── best_configs/
    └── <country>/<city>/<countrycode><id>.conf
```

Use any `.conf` file directly with the [WireGuard client](https://www.wireguard.com/install/) on Windows, macOS, Linux, iOS, or Android.

## Security

- The access token is read in-memory and discarded at process exit.
- Token input is masked in the terminal.
- The generated `[Interface]` block contains your private key treat the output directory as sensitive and store it accordingly.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) for full text.

## Links

- **Source:** [github.com/mustafachyi/NordVPN-WireGuard-Config-Generator](https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator)
- **Issues:** [Bug Tracker](https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator/issues)
