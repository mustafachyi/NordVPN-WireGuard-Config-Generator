# NordVPN WireGuard Configuration Generator

NordGen creates WireGuard configuration files using NordVPN server data and a NordLynx private key.

The project is available in three forms:

 main

The Python package and Docker image expose the same documented command-line operations, options, filtering rules, ranking rules, and output structure. They use separate implementations suited to their distribution methods.

The Web interface is a separate browser application. It uses the same general WireGuard configuration values but has different filtering, storage, and output behavior.

## Python Package

Python 3.11 or later is required.

`pipx` is recommended because it installs command-line applications in isolated environments:

````bash
pipx install nord-config-generator
````

A regular `pip` installation is also supported:

````bash
pip install nord-config-generator
````

Start interactive generation:

````bash
nordgen
````

The complete command reference is available in [`nordgen/README.md`](nordgen/README.md).

## Docker Image

The Docker image contains the Go implementation as a statically compiled binary in a `scratch` runtime image.

The application runs as a non-root user and writes its output under `/data`.

Create the host output directory before mounting it. This keeps its location and ownership explicit.

### Linux and macOS

````bash
mkdir -p generated_configs
````

````bash
docker run --rm -it --user "$(id -u):$(id -g)" --mount type=bind,src="$(pwd)/generated_configs",dst=/data mustafachyi/nordgen:latest
````

The `--user` option makes generated files belong to the current host user on normal Linux filesystems.

### Windows Command Prompt

````cmd
if not exist "generated_configs" mkdir "generated_configs"
````

````cmd
docker run --rm -it -v "%cd%\generated_configs:/data" mustafachyi/nordgen:latest
````

Docker Desktop controls the effective permissions of Windows bind mounts.

### Passing CLI Arguments

main

````bash
docker run --rm mustafachyi/nordgen:latest help
````

````bash
docker run --rm -it -v "$(pwd)/generated_configs:/data" mustafachyi/nordgen:latest --group standard --exclude-dedicated
````

The image entry point already points to the `nordgen` executable.

## Web Interface

The hosted browser application is available at:

[https://nordgen.selfhoster.win/](https://nordgen.selfhoster.win/)

The Web interface can:

- Filter servers by group, country, and city.
- Sort servers by name or load.
- Download individual WireGuard configurations.
- Copy configurations to the clipboard.
- Display configurations as QR codes.
- Create ZIP archives for the current selection.
- Exchange a NordVPN access token for a private key.

Configuration files, ZIP archives, and QR codes are generated in the browser.

The private key remains in the active application session. DNS, endpoint, keepalive, and display preferences may be stored in browser storage.

The Web interface currently accepts:

- One or more comma-separated IPv4 DNS addresses.
- Keepalive values from 15 to 120 seconds.
- Hostname or IPv4 endpoint selection.

A valid private key must be set before a generated configuration can be used. The interface can still produce a configuration template when the private-key field is empty.

The Web interface does not create the command-line `configs/` and `best_configs/` directory trees.

Its server catalogue is refreshed through the Worker and may briefly differ from the catalogue retrieved directly by the command-line applications.

Worker deployment details are documented in [`Web/worker/README.md`](Web/worker/README.md).

The HTTP API is documented in [`Web/worker/api.md`](Web/worker/api.md).

## Security

WireGuard configuration files contain the NordLynx private key. Treat generated files, downloaded archives, copied configuration text, and QR codes as sensitive.

The command-line applications do not intentionally write the NordVPN access token to generated output.

When a token is entered through an interactive terminal prompt, input is hidden or masked according to terminal support.

A token passed through `--token` may appear in:

- Shell history
- Process listings
- Command logs
- Automation logs

Use the interactive prompt on shared systems.

The Web application sends the access token to its Worker when requesting a private key. Use only deployments you trust. A third-party copy can serve modified frontend or Worker code even when it resembles this project.

The project does not claim to securely erase credentials from process or browser memory.

NordGen is an independent project and is not affiliated with, endorsed by, or supported by NordVPN or Nord Security.

## Support

If this project saves you time, there are several ways to support it.

[![GitHub stars](https://img.shields.io/github/stars/mustafachyi/NordVPN-WireGuard-Config-Generator?style=for-the-badge&color=24292e&logo=github)](https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator/stargazers)
[![Get NordVPN](https://img.shields.io/badge/Get%20NordVPN-4687FF?style=for-the-badge&logo=nordvpn&logoColor=white)](https://ref.nordvpn.com/MXIVDoJGpKT)
[![Buy Me A Coffee](https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/mustafachyi)

## License

Distributed under the GNU General Public License version 3 or later. See [`LICENSE`](LICENSE).