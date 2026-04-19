# NordVPN WireGuard Configuration Generator

A command line tool that generates optimized NordVPN WireGuard configurations. It communicates directly with NordVPN infrastructure to exchange access tokens for NordLynx private keys, fetches the live server catalogue, and ranks endpoints by current load and geographic distance from your detected location.

## Core Capabilities

*   **Intelligent Server Selection:** Ranks endpoints by live load and Haversine distance from your detected location to maximize throughput and minimize latency.
*   **Automated Credential Exchange:** Converts a standard NordVPN access token into a NordLynx private key without manual intervention.
*   **Structured Output:** Produces a clean directory hierarchy containing the full server catalogue alongside a curated `best_configs` subset for immediate deployment.
*   **Dual Operation Modes:** Accepts interactive prompts for manual use and explicit flags for scripted pipelines.
*   **Runtime Tailored Builds:** Ships as a Python package for native installation and as a Go compiled Docker image for a minimal container footprint.

## Installation

### Python Package (PyPI)

Because this is a command line application, [`pipx`](https://pipx.pypa.io/) is the recommended installer. It isolates the tool inside its own environment and exposes the executable on your PATH without touching the system Python.

```bash
pipx install nord-config-generator
```

Plain `pip` is fully supported for environments where `pipx` is unavailable.

```bash
pip install nord-config-generator
```

## Docker Execution

For a dependency free environment, the application can be run via Docker. The container ships a Go compiled binary, which keeps the image small and startup near instant. To prevent filesystem permission conflicts and ensure generated configurations are owned by the host user, the output directory **must** be created manually before execution.

### Method 1: Docker Compose (Recommended)

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

The command line interface is unified across both distributions. It accepts interactive prompts for manual configuration and explicit flags for scripted pipelines.

### Primary Operations

*   **Generation:** Run `nordgen` to fetch the catalogue and write configurations to the current directory.
*   **Key Extraction:** Run `nordgen get-key` to retrieve only the NordLynx private key without writing configuration files.

### Reference

For granular details on available flags, overrides, and parameters, invoke the built in help:

```bash
nordgen --help
```

## Web Interface

A browser based version of the generator is available for immediate use without local installation.

*   **Live Application:** [https://nordgen.selfhoster.win/](https://nordgen.selfhoster.win/)

## Support

If this project saves you time, there are a few ways to give something back.

1.  **Star the repository** on GitHub so it reaches more people who need it.
2.  **Sign up through the referral link** if you are new to NordVPN: [https://ref.nordvpn.com/MXIVDoJGpKT](https://ref.nordvpn.com/MXIVDoJGpKT)
3.  **Buy me a coffee** on Ko-fi if you want to fuel future updates: [https://ko-fi.com/mustafachyi](https://ko-fi.com/mustafachyi)

## License

Distributed under the GNU General Public License v3.0. See `LICENSE` for details.
