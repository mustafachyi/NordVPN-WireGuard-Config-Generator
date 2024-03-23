# NordVPN WireGuard Configuration Generator

Welcome to the NordVPN WireGuard Configuration Generator! This powerful Python script empowers users to effortlessly generate WireGuard configuration files tailored to their preferences from the vast array of NordVPN servers. Whether you're seeking optimal performance, specific locations, or enhanced organization, this tool has you covered.

## Table of Contents

- [Introduction](#introduction)
- [Key Features](#key-features)
- [Usage](#usage)
- [Installation](#installation)
- [Dependencies](#dependencies)
- [Contributing](#contributing)
- [License](#license)

## Introduction

Are you tired of manual configuration hassles when setting up NordVPN with WireGuard? Look no further! Our solution streamlines the process, enabling you to effortlessly access NordVPN's extensive server network with just a few simple commands.

## Key Features

### Dynamic Server Sorting
- Seamlessly sorts NordVPN servers based on load and proximity to the user's location, ensuring optimal performance and reliability.

### Intuitive Organization
- Categorizes servers by country and city, providing users with a structured view of NordVPN's vast network, making it easier to find and select preferred server locations.

### Best Server Selection
- Identifies and saves the best server configuration for each city in every country, allowing users to quickly connect to the most optimal servers with confidence.

### Zip Compression
- Offers the convenience of compressing generated configuration files into a ZIP archive, simplifying download and management tasks.

## Usage

Using the NordVPN WireGuard Configuration Generator is straightforward:

1. Obtain your NordVPN access token from the NordVPN dashboard.
2. Clone this repository to your local machine.
3. Navigate to the project directory.
4. Execute the `main.py` script, providing your access token when prompted.
5. Optionally, specify whether you want the configuration files to be compressed into a ZIP archive.
6. Sit back and let the script handle the rest!

```bash
python main.py
```

## Installation

To get started, simply clone this repository to your local machine:

```bash
git clone https://github.com/yourusername/nordvpn-wireguard-config-generator.git
```

## Dependencies

The NordVPN WireGuard Configuration Generator relies on the following Python libraries:

- `requests`
- `logging`
- `zipfile`
- `concurrent.futures`

Ensure these dependencies are installed before running the script.

## Contributing

We welcome contributions from the community! Whether it's bug fixes, feature enhancements, or documentation improvements, your contributions help make this project better for everyone. Feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
