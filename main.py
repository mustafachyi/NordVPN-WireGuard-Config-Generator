import os, requests, json, time
from concurrent.futures import ThreadPoolExecutor
from math import radians, cos, sin, asin, sqrt
from operator import itemgetter
from pathlib import Path
import base64

def get_key(token):
    token = base64.b64encode(f'token:{token}'.encode()).decode()
    headers = {'Authorization': f'Basic {token}'}
    response = requests.get("https://api.nordvpn.com/v1/users/services/credentials", headers=headers)
    response.raise_for_status()
    return response.json().get('nordlynx_private_key')

def get_servers():
    return requests.get("https://api.nordvpn.com/v1/servers?limit=7000&filters[servers_technologies][identifier]=wireguard_udp").json()

def format_name(name):
    return '_'.join(filter(None, name.replace(' ', '_').replace('-', '').split('_')))

def generate_config(key, server):
    public_key = next((data.get('value') for tech in server['technologies'] if tech['identifier'] == 'wireguard_udp' for data in tech.get('metadata', []) if data.get('name') == 'public_key'), None)
    if public_key:
        country_name = format_name(server['locations'][0]['country']['name'])
        city_name = format_name(server['locations'][0]['country'].get('city', {}).get('name', 'Unknown'))
        server_name = format_name(f"{server['name'].replace('#', '')}_{city_name}")
        config = f"""
[Interface]
PrivateKey = {key}
Address = 10.5.0.2/16
DNS = 103.86.96.100

[Peer]
PublicKey = {public_key}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = {server['station']}:51820
PersistentKeepalive = 25
"""
        return country_name, city_name, server_name, config

def save_config(key, server, path=None):
    if 'locations' in server:
        config_data = generate_config(key, server)
        if config_data:
            country_folder, city_folder, server_name, config = config_data
            if path is None:
                path = Path('configs', country_folder, city_folder, f"{server_name}.conf")
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w") as f:
                f.write(config)
            return str(path)

def calculate_distance(ulat, ulon, slat, slon):
    ulon, ulat, slon, slat = map(radians, [ulon, ulat, slon, slat])
    dlon = slon - ulon
    dlat = slat - ulat
    a = sin(dlat/2)**2 + cos(ulat) * cos(slat) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a))
    return c * 6371

def sort_servers(servers, ulat, ulon):
    for server in servers:
        slat = server['locations'][0]['latitude']
        slon = server['locations'][0]['longitude']
        server['distance'] = calculate_distance(ulat, ulon, slat, slon)
    return sorted(servers, key=lambda k: (k['load'], k['distance']))

def get_location():
    location = requests.get('https://ipinfo.io/json').json()['loc'].split(',')
    return float(location[0]), float(location[1])

def main():
    token = input("Enter your access token: ")
    key = get_key(token)
    start_time = time.time()
    if key:
        servers = get_servers()
        if servers:
            ulat, ulon = get_location()
            sorted_servers = sort_servers(servers, ulat, ulon)
            print("Starting to save configs...")
            with ThreadPoolExecutor() as executor:
                paths = list(filter(None, executor.map(save_config, [key]*len(sorted_servers), sorted_servers)))
            print("All configs saved.")

            servers_by_location = {}
            for server in sorted_servers:
                country = server['locations'][0]['country']['name']
                city = server['locations'][0]['country']['city']['name']
                if country not in servers_by_location:
                    servers_by_location[country] = {}
                if city not in servers_by_location[country]:
                    servers_by_location[country][city] = {"distance": int(server['distance']), "servers": []}
                server_info = (server['name'], f"load: {server['load']}")
                servers_by_location[country][city]["servers"].append(server_info)

            for country in servers_by_location:
                for city in servers_by_location[country]:
                    servers_by_location[country][city]["servers"].sort(key=itemgetter(1))

            Path('best_configs').mkdir(parents=True, exist_ok=True)
            for country, cities in servers_by_location.items():
                safe_country_name = format_name(country)
                for city, data in cities.items():
                    best_server = data["servers"][0]
                    best_server_info = next(server for server in servers if server['name'] == best_server[0])
                    save_config(key, best_server_info, Path('best_configs', f'{safe_country_name}_{format_name(city)}.conf'))

            servers_by_location = dict(sorted(servers_by_location.items()))

            with open('servers.json', 'w') as f:
                json.dump(servers_by_location, f, indent=2)

        else:
            print("Failed to retrieve server information.")
    else:
        print("Failed to retrieve Nordlynx Private Key.")
    end_time = time.time()  # End the timer
    elapsed_time = end_time - start_time  # Calculate the elapsed time
    print(f"Process completed in {elapsed_time} seconds")

if __name__ == "__main__":
    main()
