import os
import requests
import logging
import zipfile
from typing import Tuple, Optional, List, Dict
from concurrent.futures import ThreadPoolExecutor

# Constants
URL = "https://api.nordvpn.com/v1/servers?limit=7000&filters[servers_technologies][identifier]=wireguard_udp"
TECHNOLOGY_IDENTIFIER = 'wireguard_udp'
PUBLIC_KEY = 'public_key'

# Configure logging
logging.basicConfig(level=logging.INFO)

def get_wireguard_servers() -> Optional[List[Dict]]:
    try:
        response = requests.get(URL)
        response.raise_for_status()
        return response.json()
    except requests.HTTPError as http_err:
        logging.error(f'HTTP error occurred: {http_err}')
        raise
    except Exception as err:
        logging.error(f'Other error occurred: {err}')
        raise

def find_public_key(server_info: Dict) -> Optional[str]:
    for technology in server_info['technologies']:
        if technology['identifier'] == TECHNOLOGY_IDENTIFIER:
            metadata = technology.get('metadata', [])
            for data in metadata:
                if data.get('name') == PUBLIC_KEY:
                    return data.get('value')
    return None

def format_name(name: str) -> str:
    return name.replace(' ', '_')

def generate_wireguard_config(private_key: str, server_info: Dict) -> Tuple[str, str, str, str]:
    public_key = find_public_key(server_info)
    if public_key:
        country_name = format_name(server_info['locations'][0]['country']['name'])
        city_name = format_name(server_info['locations'][0]['country'].get('city', {}).get('name', 'Unknown'))
        server_name = format_name(f"{server_info['name'].replace('#', '')}_{city_name}")
        config = f"""
[Interface]
PrivateKey = {private_key}
Address = 10.5.0.2/16
DNS = 103.86.96.100

[Peer]
PublicKey = {public_key}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = {server_info['station']}:51820
PersistentKeepalive = 25
"""
        return country_name, city_name, server_name, config
    else:
        logging.info(f"No WireGuard public key found for {server_info['name']} in {server_info.get('city', {}).get('name', 'Unknown')}. Skipping.")
        return None, None, None, None

def save_config(private_key: str, server_info: Dict):
    try:
        if 'locations' in server_info:
            country_folder, city_folder, server_name, config = generate_wireguard_config(private_key, server_info)
            if config:
                country_path = os.path.join('configs', country_folder)
                os.makedirs(country_path, exist_ok=True)
                city_path = os.path.join(country_path, city_folder)
                os.makedirs(city_path, exist_ok=True)
                filename = f"{server_name}.conf"
                filepath = os.path.join(city_path, filename)
                with open(filepath, "w") as f:
                    f.write(config)
                    logging.info(f"WireGuard configuration for {server_name} saved to {filepath}")
                return city_path
    except Exception as e:
        logging.error(f"Error occurred while saving config: {e}")
    return None

def zip_configs(city_path: str):
    zipf = zipfile.ZipFile(f'{city_path}.zip', 'w', zipfile.ZIP_DEFLATED)
    for root, dirs, files in os.walk(city_path):
        for file in files:
            zipf.write(os.path.join(root, file), arcname=file)
    zipf.close()
    logging.info(f"Zipped configuration files for {city_path}")

def main():
    private_key = input("Enter your PrivateKey: ")
    zip_files = input("Do you want to zip the configuration files? (yes/no): ").lower()
    if zip_files not in ['yes', 'no']:
        print("Invalid input. Please enter either 'yes' or 'no'.")
        return
    all_servers = get_wireguard_servers()
    if all_servers:
        with ThreadPoolExecutor() as executor:
            city_paths = list(set(executor.map(save_config, [private_key]*len(all_servers), all_servers)))
            city_paths = [path for path in city_paths if path is not None]
            if zip_files == 'yes':
                for city_path in city_paths:
                    zip_configs(city_path)

if __name__ == "__main__":
    main()
