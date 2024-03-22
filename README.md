# NordVPN WireGuard Configuration Generator

This repository contains a set of Python scripts designed to automate the process of generating WireGuard configuration files for all NordVPN servers.

## Table of Contents

- [File Descriptions](#file-descriptions)
- [Usage](#usage)
- [Dependencies](#dependencies)
- [Disclaimer](#disclaimer)

## File Descriptions

- `extract_key.py`: This script interacts with the NordVPN API to extract the Nordlynx private key. It requires an access token as input and outputs the private key.

- `main.py`: This script is responsible for generating WireGuard configuration files for NordVPN servers. It requires the private key (obtained from `extract_key.py`) as input and has an option to compress the configuration files into a ZIP archive.

## Usage

1. Execute `extract_key.py` to retrieve your Nordlynx private key. You will need to provide your NordVPN access token.

```bash
python extract_key.py
```

2. Execute `main.py` to generate the WireGuard configuration files. You will need to provide the private key obtained from the previous step and specify whether you want the configuration files to be compressed into a ZIP archive.

```bash
python main.py
```

## Dependencies

This project is built with Python 3 and utilizes the following libraries:

- `requests`
- `logging`
- `zipfile`
- `concurrent.futures`

Please ensure these dependencies are installed before executing the scripts.

## Disclaimer

This project is independently developed and is not affiliated with NordVPN. Please use it responsibly and at your own risk.
