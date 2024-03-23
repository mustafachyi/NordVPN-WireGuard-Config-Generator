from operator import itemgetter
import os
import requests
import logging
import zipfile
import subprocess
import json
from typing import Tuple, Optional, List, Dict
from concurrent.futures import ThreadPoolExecutor
from math import radians, cos, sin, asin, sqrt

# Constants
URL = "https://api.nordvpn.com/v1/servers?limit=7000&filters[servers_technologies][identifier]=wireguard_udp"
TECHNOLOGY_IDENTIFIER = 'wireguard_udp'
PUBLIC_KEY = 'public_key'

# Configure logging
logging.basicConfig(level=logging.INFO)

def get_nordlynx_private_key(access_token):
    try:
        output = subprocess.check_output(["curl", "-s", "-u", f"token:{access_token}", "https://api.nordvpn.com/v1/users/services/credentials"])
        data = json.loads(output.decode('utf-8'))
        return data.get('nordlynx_private_key')
    except subprocess.CalledProcessError as e:
        print(f"Error: {e}")
        return None
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON: {e}")
        return None

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

def save_config(private_key: str, server_info: Dict, filepath: str = None):
    try:
        if 'locations' in server_info:
            country_folder, city_folder, server_name, config = generate_wireguard_config(private_key, server_info)
            if config:
                if filepath is None:
                    country_path = os.path.join('configs', country_folder)
                    os.makedirs(country_path, exist_ok=True)
                    city_path = os.path.join(country_path, city_folder)
                    os.makedirs(city_path, exist_ok=True)
                    filename = f"{server_name}.conf"
                    filepath = os.path.join(city_path, filename)
                with open(filepath, "w") as f:
                    f.write(config)
                    logging.info(f"WireGuard configuration for {server_name} saved to {filepath}")
                return filepath
    except Exception as e:
        logging.error(f"Error occurred while saving config: {e}")
    return None

def zip_configs(city_folder: str):
    city_name = os.path.basename(city_folder)
    zip_file_path = f"{city_folder}.zip"
    
    with zipfile.ZipFile(zip_file_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(city_folder):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, start=os.path.dirname(city_folder))
                zipf.write(file_path, arcname=arcname)
    
    logging.info(f"Zipped configuration files for {city_name} into {zip_file_path}")


def calculate_distance(user_latitude, user_longitude, server_latitude, server_longitude):
    # Convert decimal degrees to radians
    user_longitude, user_latitude, server_longitude, server_latitude = map(radians, [user_longitude, user_latitude, server_longitude, server_latitude])

    # Haversine formula
    dlon = server_longitude - user_longitude
    dlat = server_latitude - user_latitude
    a = sin(dlat/2)**2 + cos(user_latitude) * cos(server_latitude) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a))
    r = 6371 # Radius of earth in kilometers
    return c * r

def sort_servers(servers, user_latitude, user_longitude):
    for server in servers:
        server_latitude = server['locations'][0]['latitude']
        server_longitude = server['locations'][0]['longitude']
        server['distance'] = calculate_distance(user_latitude, user_longitude, server_latitude, server_longitude)
    return sorted(servers, key=lambda k: (k['load'], k['distance']))

def get_user_location():
    try:
        response = requests.get('https://ipinfo.io/json')
        response.raise_for_status()
        data = response.json()
        location = data['loc'].split(',')
        return float(location[0]), float(location[1])
    except requests.HTTPError as http_err:
        logging.error(f'HTTP error occurred: {http_err}')
        raise
    except Exception as err:
        logging.error(f'Other error occurred: {err}')
        raise

def zip_best_configs():
    best_configs_path = 'best_configs'
    zipf = zipfile.ZipFile(f'{best_configs_path}.zip', 'w', zipfile.ZIP_DEFLATED)
    for root, dirs, files in os.walk(best_configs_path):
        for file in files:
            file_path = os.path.join(root, file)
            arcname = os.path.relpath(file_path, start=best_configs_path)
            zipf.write(file_path, arcname=arcname)
    zipf.close()
    logging.info("Zipped best configuration files")

# The rest of the functions remain unchanged

def main():
    access_token = input("Enter your access token: ")
    private_key = get_nordlynx_private_key(access_token)
    if private_key:
        zip_files = input("Do you want to zip the configuration files? (yes/no): ").lower()
        if zip_files not in ['yes', 'no']:
            print("Invalid input. Please enter either 'yes' or 'no'.")
            return
        all_servers = get_wireguard_servers()
        if all_servers:
            user_latitude, user_longitude = get_user_location()
            sorted_servers = sort_servers(all_servers, user_latitude, user_longitude)
            with ThreadPoolExecutor() as executor:
                city_paths = list(set(executor.map(save_config, [private_key]*len(sorted_servers), sorted_servers)))
                city_paths = [path for path in city_paths if path is not None]
                if zip_files == 'yes':
                    # Create a set to store unique city folder paths
                    unique_city_folders = set()
                    for city_path in city_paths:
                        # Extract the city folder path and add it to the set
                        city_folder = os.path.dirname(city_path)
                        unique_city_folders.add(city_folder)
                    
                    # Zip the contents of each unique city folder
                    for city_folder in unique_city_folders:
                        zip_configs(city_folder)
                    
                    # Zip the best configurations if needed
                    zip_best_configs()

            # Group servers by country and city
            servers_by_location = {}
            for server in sorted_servers:
                country = server['locations'][0]['country']['name']
                city = server['locations'][0]['country']['city']['name']
                if country not in servers_by_location:
                    servers_by_location[country] = {}
                if city not in servers_by_location[country]:
                    servers_by_location[country][city] = {"distance": int(server['distance']), "servers": []}
                server_info = (server['name'], server['load'])
                servers_by_location[country][city]["servers"].append(server_info)

            # Sort the servers in each city by load
            for country in servers_by_location:
                for city in servers_by_location[country]:
                    servers_by_location[country][city]["servers"].sort(key=itemgetter(1))

            # Save the best config for each city in each country
            if not os.path.exists('best_configs'):
                os.makedirs('best_configs')
            for country, cities in servers_by_location.items():
                for city, data in cities.items():
                    best_server = data["servers"][0]
                    best_server_info = next(server for server in all_servers if server['name'] == best_server[0])
                    save_config(private_key, best_server_info, os.path.join('best_configs', f'{country}_{city}.conf'))

            # Sort the countries alphabetically
            servers_by_location = dict(sorted(servers_by_location.items()))

            # Write the servers to a file
            with open('servers.json', 'w') as f:
                for country, cities in servers_by_location.items():
                    f.write(f'"{country}":' + '{')
                    for city, data in cities.items():
                        json_data = json.dumps({city: data}, separators=(',', ':'))
                        f.write(json_data[1:-1] + ',\n')
                    f.write('},')

        else:
            print("Failed to retrieve server information.")
    else:
        print("Failed to retrieve Nordlynx Private Key.")

if __name__ == "__main__":
    main()
