# NordVPN WireGuard Configuration Generator

A professional command-line interface for generating optimized NordVPN WireGuard configurations. This tool interacts directly with NordVPN infrastructure to authenticate users, retrieve private keys, and select the optimal servers based on real-time network load and geographic proximity.

## Core Capabilities

*   **Intelligent Optimization:** Algorithms prioritize servers by current load and physical distance to maximize throughput and minimize latency.
*   **Automated Credential Exchange:** Securely exchanges standard access tokens for NordLynx private keys.
*   **Structured Output:** Generates a clean directory hierarchy containing standard configurations and a dedicated `best_configs` subset for immediate deployment.
*   **Dual Operation Modes:** Supports a rich interactive TUI for manual operation and strict non-interactive flags for automated pipelines.
*   **Cross-Platform Availability:** Maintained in both Python and Go to ensure broad compatibility and performance.

## Installation

### Python Package (PyPI)

The application can be installed directly from the Python Package Index.

```bash
pip install nord-config-generator
```

## Docker Execution

For a dependency-free environment, the application can be executed via Docker. To prevent filesystem permission conflicts and ensure generated configurations are owned by the host user, the output directory **must** be created manually before execution.

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

3.  **Execute the container:**
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

The command-line interface is unified across all distributions. It supports both interactive prompts for manual configuration and flag-based execution for automated pipelines.

### Primary Operations

*   **Generation:** Execute `nordgen` to initiate the standard processing workflow.
*   **Key Extraction:** Execute `nordgen get-key` to isolate the private key retrieval process.

### Reference

For granular details on available flags, overrides, and parameters, invoke the internal documentation:

```bash
nordgen --help
```

## Web Interface

A browser-based version of the generator is available for immediate use without local installation.

*   **Live Application:** [https://nord-configs.selfhoster.nl/](https://nord-configs.selfhoster.nl/)

## Support

Contributions to project visibility and sustainability are appreciated.

1.  **Repository:** Star the project on GitHub.
2.  **Referral:** [https://ref.nordvpn.com/MXIVDoJGpKT](https://ref.nordvpn.com/MXIVDoJGpKT)

## License

Distributed under the GNU General Public License v3.0. See `LICENSE` for details.
