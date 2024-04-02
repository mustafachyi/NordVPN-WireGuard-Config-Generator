# NordVPN WireGuard Configuration Generator & Proxy Servers Fetcher

Our NordVPN WireGuard Configuration Generator simplifies the process of setting up optimized WireGuard configuration files for NordVPN servers. Additionally, it includes a script to fetch proxy servers from the NordVPN API in a user-friendly format. The tool also automates the installation of cURL on your machine, making it ready for network tasks. By utilizing advanced algorithms and the NordVPN API, this tool makes connecting to the best servers based on factors like server load, proximity, and performance effortless.

## Introduction

Setting up WireGuard for NordVPN can be complex, but our generator streamlines this process. It automatically creates optimized configuration files based on your preferences and location. The included script fetches proxy servers from NordVPN's API and saves them for easy use. Plus, the cURL installer ensures your machine is ready for network tasks.

## Key Features

- **Automated Server Sorting**: Servers are intelligently sorted for optimal performance.
- **Intuitive Organization**: Servers are categorized by country and city for easy navigation.
- **Best Server Selection**: Finds the best server configurations for you.
- **Location-Based Optimization**: Prioritizes servers close to you for faster connections.
- **Server Load Balancing**: Connects you to less congested servers.
- **Configuration File Management**: Files are neatly organized for easy management.
- **Proxy Server Fetching**: Fetches proxy servers from NordVPN's API.
- **cURL Installer**: Automates the installation of cURL for network tasks.

## Usage

Before using the script, ensure that cURL is installed on your machine.

1. Install cURL on your machine using the following command:

```bash
python install_curl.py
```

2. Obtain your NordVPN access token.
3. Clone the repository.
4. Run `main.py` and enter your access token.
5. Follow the prompts to generate WireGuard configurations.
6. Utilize `proxy_fetcher.py` for proxy servers.

This approach ensures that cURL is correctly installed on your machine before proceeding with other tasks related to the tool.

## Installation

To install the tool, clone the repository:

```bash
git clone https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator.git
```

## Dependencies

Ensure you have the following Python libraries installed:

- `requests`
- `logging`
- `subprocess`
- `concurrent.futures`

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests to improve the tool.

## License

This project is licensed under GNU License. See [LICENSE](LICENSE) for details.

We hope this tool simplifies your VPN setup and enhances your NordVPN experience. Reach out if you need assistance!
