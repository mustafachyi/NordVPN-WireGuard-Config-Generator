# NordVPN WireGuard Configuration Generator & Proxy Servers Fetcher

Our NordVPN WireGuard Configuration Generator is designed to make setting up optimized WireGuard configuration files for NordVPN servers a breeze. Plus, it now includes a script to fetch proxy servers from the NordVPN API in a user-friendly format and automatically installs cURL on your machine. By using advanced algorithms and the NordVPN API, this tool makes connecting to the best servers based on factors like server load, proximity, and performance effortless.

## Introduction

Setting up WireGuard for NordVPN can be complex, but our generator simplifies the process. It automatically creates optimized configuration files based on your preferences and location. The added script fetches proxy servers from NordVPN's API and saves them for easy use. Plus, the cURL installer ensures your machine is ready for network tasks.

## Key Features

- **Automated Server Sorting**: Servers are sorted intelligently for optimal performance.
- **Intuitive Organization**: Servers are categorized by country and city for easy navigation.
- **Best Server Selection**: Finds the best server configurations for you.
- **Location-Based Optimization**: Prioritizes servers close to you for faster connections.
- **Server Load Balancing**: Connects you to less congested servers.
- **Configuration File Management**: Files are neatly organized for easy management.
- **Proxy Server Fetching**: Fetches proxy servers from NordVPN's API.
- **cURL Installer**: Installs cURL for network tasks.

## Usage

1. Get your NordVPN access token.
2. Clone the repository.
3. Run `main.py` and enter your access token.
4. Follow prompts to generate WireGuard configurations.
5. Use `proxy_fetcher.py` for proxy servers and `install_curl.py` for cURL.

```bash
python main.py
python proxy_fetcher.py
python install_curl.py
```

## Installation

Clone the repository to install:

```bash
git clone https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator.git
```

## Dependencies

Ensure you have these Python libraries installed:

- `requests`
- `logging`
- `subprocess`
- `concurrent.futures`

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests to improve the tool.

## License

This project is licensed under GNU License. See [LICENSE](LICENSE) for details.

We hope this tool simplifies your VPN setup and improves your NordVPN experience. Reach out if you need assistance!
