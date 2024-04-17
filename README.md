# NordVPN WireGuard Configuration Generator & Proxy Servers Fetcher

Welcome to the NordVPN WireGuard Configuration Generator & Proxy Servers Fetcher tool! This project aims to simplify the process of setting up optimized WireGuard configuration files for NordVPN servers while also providing a convenient way to fetch proxy servers from the NordVPN API. As a bonus addition to the project, we are introducing versions of the tool written in Go and Rust languages for users who prefer these over Python, along with a web version that generates configuration files without the private key, making the use of the access token optional for added security.

We are committed to keeping our website ad-free for a better user experience. You can help us maintain this by supporting the creator. Simply use the referral link provided on the website to get your NordVPN subscription. This way, you get a free 1 to 3 months of NordVPN, and we get a little something back for creating this tool.

If you find this project useful, please consider giving it a star to show your love and support!

## Introduction

Setting up WireGuard for NordVPN can be complex, but our generator streamlines this process. It automatically creates optimized configuration files based on your preferences and location. The included script fetches proxy servers from NordVPN's API and saves them for easy use. With the introduction of the Go, Rust versions and the web version (where the user must add the private key manually after downloading the configuration for added security or opt to use the access token), users now have additional options for utilizing the tool.

## Key Features

- **Automated Server Sorting**: Servers are intelligently sorted for optimal performance.
- **Intuitive Organization**: Servers are categorized by country and city for easy navigation.
- **Best Server Selection**: Finds the best server configurations for you.
- **Location-Based Optimization**: Prioritizes servers close to you for faster connections.
- **Server Load Balancing**: Connects you to less congested servers.
- **Configuration File Management**: Files are neatly organized for easy management.
- **Proxy Server Fetching**: Fetches proxy servers from NordVPN's API.
- **Multi-Language Support**: Available in Python, Go, and Rust versions to cater to different user preferences.

## Usage

Before using the script, ensure that the necessary dependencies are installed for the respective version you choose (Python, Go, Rust, or web).

### Rust Version

1. Install Rust on your machine if you haven't already. You can download it from the [official Rust website](https://www.rust-lang.org/tools/install).
2. Obtain your NordVPN access token.
3. Clone the repository.
4. You have two options for running the Rust version:

   a. **Compile from Source**:
      - Navigate to the cloned repository directory.
      - Use the appropriate build commands for your operating system (e.g., `cargo build --release`).
      - Run the compiled executable and enter your NordVPN access token when prompted.
      - Follow the prompts to generate WireGuard configurations.

   b. **Use Pre-compiled Executable**:
      - Visit the [Releases](https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator/releases) section of the repository.
      - Download the pre-compiled executable for your operating system.
      - Run the executable and enter your NordVPN access token when prompted.
      - Follow the prompts to generate WireGuard configurations.

### Python Version

1. Obtain your NordVPN access token.
2. Clone the repository.
3. Run `main.py` and enter your access token.
4. Follow the prompts to generate WireGuard configurations.
5. Utilize `proxy_fetcher.py` for proxy servers.

### Go Version

1. Install Go on your machine if you haven't already. You can download it from the [official Go website](https://golang.org/dl/).
2. Obtain your NordVPN access token.
3. Clone the repository.
4. You have two options for running the Go version:

   a. **Compile from Source**:
      - Navigate to the cloned repository directory.
      - Use the appropriate build commands for your operating system (e.g., `go build main.go`).
      - Run the compiled executable and enter your NordVPN access token when prompted.
      - Follow the prompts to generate WireGuard configurations.

   b. **Use Pre-compiled Executable**:
      - Visit the [Releases](https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator/releases) section of the repository.
      - Download the pre-compiled executable for your operating system.
      - Run the executable and enter your NordVPN access token when prompted.
      - Follow the prompts to generate WireGuard configurations.

### Web Version

1. Visit the web version tool at [nord-configs-crafter](https://nord-configs-crafter.pages.dev/).
2. Follow the prompts to generate WireGuard configurations.
3. After downloading the configuration, manually add the private key for added security or use the access token to retrieve the private key.

By providing these options, users can choose the method that best suits their preferences and technical expertise.

## Installation

To install the tool, clone the repository:

```bash
git clone https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator.git
```

For the Go and Rust versions, you have the flexibility to either compile from source or use pre-compiled executables available in the Releases section.

## Dependencies

Ensure you have the following dependencies installed based on the version you choose:

- Python Version: `requests`, `logging`, `subprocess`, `concurrent.futures`
- Go Version: Go programming language
- Rust Version: Rust programming language
- Web Version: Web browser with internet access

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests to improve either the Python, Go, Rust, or web version of the tool.

## License

This project is licensed under GNU License. See [LICENSE](LICENSE) for details.

We hope this tool simplifies your VPN setup and enhances your NordVPN experience. Choose the version that suits your needs and reach out if you need assistance! If you appreciate our work, please give us a star on GitHub to show your support!
