# NordVPN WireGuard Configuration Generator

This Python script generates WireGuard configuration files for NordVPN servers. It fetches the server data from NordVPN's API, generates the configuration files, and optionally zips them for easy distribution.

## Requirements

- Python 3.6 or higher
- `requests` library

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/yourrepository.git
   ```
2. Install the required Python libraries:
   ```
   pip install requests
   ```

## Usage

1. Run the script:
   ```
   python main.py
   ```
2. When prompted, enter your private key.
3. When prompted, enter 'yes' if you want the configuration files to be zipped, 'no' otherwise.

## Functionality

The script performs the following tasks:

- Fetches server data from NordVPN's API.
- Generates WireGuard configuration files for each server.
- Saves the configuration files in a directory structure based on the server's country and city.
- Optionally zips the configuration files for each city.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](https://choosealicense.com/licenses/mit/)
