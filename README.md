# NordVPN WireGuard Configuration Generator

A command-line tool that generates optimized NordVPN WireGuard configurations. It communicates directly with NordVPN infrastructure to exchange access tokens for NordLynx private keys, fetches the live server catalogue, and ranks endpoints by current load and geographic distance from your detected location.

## Core Capabilities

*   **Intelligent Server Selection:** Ranks endpoints by live load and Haversine distance from your detected location. Optionally probes TCP connect latency (`-l` / `--latency`) so `best_configs` reflect real RTT from your machine.
*   **Automated Credential Exchange:** Converts a standard NordVPN access token into a NordLynx private key without manual intervention.
*   **Structured Output:** Produces a clean directory hierarchy containing the full server catalogue alongside a curated `best_configs` subset for immediate deployment.
*   **Dual Operation Modes:** Accepts interactive prompts for manual use and explicit flags for scripted pipelines.
*   **Runtime Tailored Builds:** Ships as a Python package for native installation and as a Go-compiled Docker image for a minimal container footprint.

## Installation

### Python Package (PyPI)

Because this is a command-line application, `pipx` is the recommended installer. It isolates the tool inside its own environment and exposes the executable on your PATH without touching the system Python.

```bash
pipx install nord-config-generator
```

Plain `pip` is fully supported for environments where `pipx` is unavailable.

```bash
pip install nord-config-generator
```

## Docker Execution

For a dependency-free environment, the application can be run via Docker. The container ships a Go-compiled binary, which keeps the image small and startup near instant. To prevent filesystem permission conflicts and ensure generated configurations are owned by the host user, the output directory **must** be created manually before execution.

### Method 1: Docker Compose

1.  **Initialize the output directory:**
    ```bash
    mkdir -p generated_configs
    ```

2.  **Create a `docker-compose.yml` file:**
    ```yaml
    services:
      nordgen:
        image: mustafachyi/nordgen:latest
        stdin_open: true
        tty: true
        user: "${UID:-1000}:${GID:-1000}"
        volumes:
          - ./generated_configs:/data
    ```

3.  **Run the container:**
    ```sh
    docker-compose run --rm nordgen
    ```

### Method 2: Docker CLI

**Linux / macOS:**
```sh
mkdir -p generated_configs && docker run -it --rm -u $(id -u):$(id -g) -v "$(pwd)/generated_configs:/data" mustafachyi/nordgen:latest
```

**Windows (PowerShell):**
```sh
if (!(Test-Path "generated_configs")) { mkdir generated_configs }; docker run -it --rm -v "${PWD}/generated_configs:/data" mustafachyi/nordgen:latest
```

**Windows (Command Prompt):**
```sh
if not exist "generated_configs" mkdir "generated_configs" && docker run -it --rm -v "%cd%/generated_configs:/data" mustafachyi/nordgen:latest
```

## Usage Guide

The command-line interface is unified across both distributions. It accepts interactive prompts for manual configuration and explicit flags for scripted pipelines.

### Primary Operations

*   **Generation:** Run `nordgen` to fetch the catalogue and write configurations to the current directory.
*   **Key Extraction:** Run `nordgen get-key` to retrieve only the NordLynx private key without writing configuration files.

### Configuration Reference

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-t`, `--token` | NordVPN Access Token (Required for automated mode) | Prompted |
| `-d`, `--dns` | DNS Server IP written to configurations | `103.86.96.100` |
| `-i`, `--ip` | Use explicit IP endpoints instead of domain hostnames | `false` |
| `-k`, `--keepalive` | Persistent Keepalive interval (seconds) | `25` |
| `-g`, `--group` | Server groups to include (`standard`, `p2p`, `dedicated`, `onion`, `double`) | All groups |
| `-e`, `--exclude-dedicated`| Exclude dedicated IP group servers from generating | `false` |
| `-l`, `--latency` | Measure TCP connect latency to candidates and rank `best_configs` by real RTT | `false` |

### Help

For granular details on available flags, overrides, and parameters, invoke the built-in help:

```bash
nordgen --help
```

## Web Interface

A browser-based version of the generator is available for immediate use without local installation.

Please note that the link below is the only hosted instance under my ownership, and it runs the exact source code published in this repository. 

If for whatever reason you choose to use another site that looks similar to mine, you do so strictly at your own risk. Third-party clones can easily modify the underlying code behind the scenes to put your data in danger or intercept your access tokens.

*   **Live Application:** [https://nordgen.selfhoster.win/](https://nordgen.selfhoster.win/)

## Dedicated IP Servers

The server catalogue contains endpoints designated under the `Dedicated IP` group. These servers require a specific, active `Dedicated IP` add-on subscription associated with your NordVPN account. 

If you have not purchased this add-on from NordVPN, attempting to connect to these endpoints will fail, even with a valid NordLynx private key and active subscription. Standard accounts should exclude these endpoints by passing the `-e` / `--exclude-dedicated` flag, or selectively target general-connectivity groups like `standard` or `p2p` using the `-g` / `--group` flag.

## Support

If this project saves you time, there are a few ways to give something back.

[![GitHub stars](https://img.shields.io/github/stars/mustafachyi/NordVPN-WireGuard-Config-Generator?style=for-the-badge&color=24292e&logo=github)](https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator/stargazers)
[![Get NordVPN](https://img.shields.io/badge/Get%20NordVPN-4687FF?style=for-the-badge&logo=nordvpn&logoColor=white)](https://ref.nordvpn.com/MXIVDoJGpKT)
[![Buy Me A Coffee](https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/mustafachyi)

## License

Distributed under the GNU General Public License v3.0. See `LICENSE` for details.
