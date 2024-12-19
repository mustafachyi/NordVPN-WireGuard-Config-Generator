# NordVPN WireGuard Configuration Generator & Proxy Servers Fetcher

Welcome to the NordVPN WireGuard Configuration Generator & Proxy Servers Fetcher tool! This tool simplifies the setup of optimized WireGuard configuration files for NordVPN servers and provides a way to fetch proxy servers from the NordVPN API. We offer versions of the tool in Python, Go, Rust, Node.js, Ruby, and a web version for added convenience.

## Table of Contents

- [Introduction](#introduction)
- [Key Features](#key-features)
- [Usage](#usage)
- [Installation](#installation)
- [Dependencies](#dependencies)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

## Introduction

Setting up WireGuard for NordVPN can be complex, but our generator streamlines this process by creating optimized configuration files based on your preferences and location. The included script also fetches proxy servers from NordVPN's API for easy use.

## Key Features

- **Automated Server Sorting**: Optimally sorts servers for performance.
- **Intuitive Organization**: Categorizes servers by country and city.
- **Best Server Selection**: Finds the best configurations for you.
- **Location-Based Optimization**: Prioritizes nearby servers for faster connections.
- **Server Load Balancing**: Connects you to less congested servers.
- **Configuration File Management**: Neatly organizes files for easy management.
- **Proxy Server Fetching**: Retrieves proxy servers from NordVPN's API.
- **Multi-Language Support**: Available in Python, Go, Rust, Node.js, Ruby, and web versions.
- **Security Assurance with `get-key.py`**: Added a simple script to ensure your private key is securely obtained without logging data.

## Usage

Before using the script, ensure that the necessary dependencies are installed for the respective version you choose.

### Python Version

1. Obtain your NordVPN access token.
2. Clone the repository.
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Run `main.py` and enter your access token.
5. Follow the prompts to generate WireGuard configurations.
6. Utilize `proxy_fetcher.py` for proxy servers.
7. **Optional**: For added security, use the `get-key.py` script to ensure your private key is securely obtained directly by you.

### Go Version (fastest based on my tests)

1. Install Go on your machine.
2. Obtain your NordVPN access token.
3. Clone the repository.
4. Compile from source or use pre-compiled executables.
5. Follow the prompts to generate WireGuard configurations.

### Rust Version

1. Install Rust on your machine.
2. Obtain your NordVPN access token.
3. Clone the repository.
4. Compile from source or use pre-compiled executables.
5. Follow the prompts to generate WireGuard configurations.

### Node.js Version

1. Install Node.js on your machine.
2. Obtain your NordVPN access token.
3. Clone the repository.
4. Install dependencies:
   ```bash
   npm install axios
   ```
5. Run with npm or pre-built script.
6. Follow the prompts to generate WireGuard configurations.

### Ruby Version

1. Install Ruby on your machine.
2. Obtain your NordVPN access token.
3. Clone the repository.
4. Install dependencies:
   ```bash
   gem install oj
   ```
5. Run the script and enter your NordVPN access token when prompted.
6. Follow the prompts to generate WireGuard configurations.

### Web Version

1. Visit the web tool at [nord-configs-crafter](https://wg-nord.pages.dev/).
2. Follow the prompts to generate WireGuard configurations.
3. After downloading the configuration, manually add the private key or use the access token for security.

### New Web Version Remake

1. Visit the new web tool remake at [nord-configs](https://nord-configs.onrender.com/).
2. Follow the prompts to generate WireGuard configurations.
3. After downloading the configuration, manually add the private key or use the access token for security.

## Installation

Clone the repository to install the tool:

```bash
git clone https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator.git
```

For Go, Rust, Node.js, Ruby, and web versions, you can compile from source or use pre-compiled executables.

## Dependencies

Ensure you have the following dependencies installed based on the version you choose:

- **Python Version**: `aiohttp`, `aiofiles`, `numpy`
- **Go Version**: Go programming language
- **Rust Version**: Rust programming language
- **Node.js Version**: `axios` library installed via `npm install axios`
- **Ruby Version**: `oj` gem installed via `gem install oj`
- **Web Version**: Web browser with internet access

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests to improve any version of the tool.

## License

This project is licensed under the GNU License. See LICENSE for details.

## Support

We appreciate your support in making this project better! Please consider:

- **Starring this Project on GitHub**: Show your love and support by starring the project on GitHub.
- **Using Our Referral Link**: Support the project creator by using the referral link provided on the website to get your NordVPN subscription. You get a free 1 to 3 months of NordVPN, and we get a little something back for creating this tool.

We hope this tool simplifies your VPN setup and enhances your NordVPN experience. Choose the version that suits your needs and reach out if you need assistance!
