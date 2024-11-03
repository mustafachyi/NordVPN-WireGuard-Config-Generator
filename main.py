import aiohttp
import asyncio
import json
import time
from math import radians, cos, sin, asin, sqrt
from pathlib import Path
import base64
import re
import aiofiles
import numpy as np
from concurrent.futures import ProcessPoolExecutor

INVALID_FILENAME_CHARS = r'[<>:"/\\|?*\0]'

def sanitize_filename(name):
    name = re.sub(INVALID_FILENAME_CHARS, '', name)
    name = name.lower().replace(' ', '_')
    return name[:255]  # Typical max filename length

def format_name(name):
    return '_'.join(filter(None, name.replace(' ', '_').replace('-', '').split('_')))

def calculate_distance(ulat, ulon, slat, slon):
    ulon, ulat, slon, slat = map(radians, [ulon, ulat, slon, slat])
    dlon = slon - ulon
    dlat = slat - ulat
    a = sin(dlat / 2)**2 + cos(ulat) * cos(slat) * sin(dlon / 2)**2
    c = 2 * asin(sqrt(a))
    return c * 6371  # Earth radius in kilometers

async def get_key(session, token):
    token_encoded = base64.b64encode(f'token:{token}'.encode()).decode()
    headers = {'Authorization': f'Basic {token_encoded}'}
    async with session.get("https://api.nordvpn.com/v1/users/services/credentials", headers=headers) as response:
        if response.status != 200:
            return None
        data = await response.json()
        return data.get('nordlynx_private_key')

async def get_servers(session):
    url = "https://api.nordvpn.com/v1/servers?limit=7000&filters[servers_technologies][identifier]=wireguard_udp"
    async with session.get(url) as response:
        if response.status != 200:
            return []
        return await response.json()

async def get_location(session):
    async with session.get('https://ipinfo.io/json') as response:
        if response.status != 200:
            return None, None
        data = await response.json()
        loc = data.get('loc', '0,0').split(',')
        if len(loc) != 2:
            return None, None
        return float(loc[0]), float(loc[1])

def generate_config(key, server):
    public_key = next(
        (data.get('value') for tech in server.get('technologies', [])
         if tech.get('identifier') == 'wireguard_udp'
         for data in tech.get('metadata', [])
         if data.get('name') == 'public_key'), None)
    if public_key:
        country_name = sanitize_filename(format_name(server['locations'][0]['country']['name']))
        city_name = sanitize_filename(format_name(server['locations'][0]['country'].get('city', {}).get('name', 'unknown')))
        server_name = sanitize_filename(format_name(f"{server['name'].replace('#', '')}_{city_name}"))
        config = f"""[Interface]
PrivateKey = {key}
Address = 10.5.0.2/16
DNS = 103.86.96.100

[Peer]
PublicKey = {public_key}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = {server['hostname']}:51820
PersistentKeepalive = 25
"""
        return country_name, city_name, server_name, config
    return None

async def save_config(key, server, semaphore, base_path='configs'):
    if 'locations' in server:
        config_data = generate_config(key, server)
        if config_data:
            country_folder, city_folder, server_name, config = config_data
            path = Path(base_path) / country_folder / city_folder
            file_path = path / f"{server_name}.conf"
            async with semaphore:
                try:
                    path.mkdir(parents=True, exist_ok=True)  # Synchronously create directories
                    async with aiofiles.open(file_path, "w") as f:
                        await f.write(config)
                    return True
                except:
                    return False
    return False

async def save_best_config(key, best_server_info, semaphore, base_path='best_configs'):
    config_data = generate_config(key, best_server_info)
    if config_data:
        country_folder, city_folder, server_name, config = config_data
        path = Path(base_path) / country_folder / city_folder
        file_path = path / f"{server_name}.conf"
        async with semaphore:
            try:
                path.mkdir(parents=True, exist_ok=True)  # Synchronously create directories
                async with aiofiles.open(file_path, "w") as f:
                    await f.write(config)
                return True
            except:
                return False
    return False

async def main():
    token = input("Enter your access token: ")
    if not token:
        return

    start_time = time.time()
    semaphore = asyncio.Semaphore(200)  # Increase the limit for concurrent file writes

    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=200)) as session:
        try:
            # Fetch key, servers, and location concurrently
            key_task = asyncio.create_task(get_key(session, token))
            servers_task = asyncio.create_task(get_servers(session))
            location_task = asyncio.create_task(get_location(session))
            key, servers, location = await asyncio.gather(key_task, servers_task, location_task)
            if location is None:
                ulat, ulon = None, None
            else:
                ulat, ulon = location
        except:
            return

        if not key or not servers or ulat is None or ulon is None:
            return

        # Group servers by country and city
        servers_by_location = {}
        for server in servers:
            try:
                country = server['locations'][0]['country']['name']
                city = server['locations'][0]['country'].get('city', {}).get('name', 'unknown')
                servers_by_location.setdefault((country, city), []).append(server)
            except:
                continue

        # Calculate distances for each unique location
        distances = {}
        for (country, city), servers in servers_by_location.items():
            slat = servers[0]['locations'][0]['latitude']
            slon = servers[0]['locations'][0]['longitude']
            distances[(country, city)] = calculate_distance(ulat, ulon, slat, slon)

        # Assign distances to servers
        for (country, city), servers in servers_by_location.items():
            distance = distances[(country, city)]
            for server in servers:
                server['distance'] = distance

        # Convert load to integer if it's not already
        for server in servers:
            try:
                server['load'] = int(server.get('load', 0))
            except:
                server['load'] = 0

        # Flatten the servers list
        sorted_servers = [server for servers in servers_by_location.values() for server in servers]

        # Sort servers by load and distance
        sorted_servers = sorted(sorted_servers, key=lambda k: (k['load'], k['distance']))

        # Save all configs
        save_tasks = [
            asyncio.create_task(save_config(key, server, semaphore))
            for server in sorted_servers
        ]
        saved_results = await asyncio.gather(*save_tasks, return_exceptions=True)
        saved_count = sum(1 for result in saved_results if result is True)

        # Organize servers by location
        servers_by_location = {}
        for server in sorted_servers:
            try:
                country = server['locations'][0]['country']['name']
                city = server['locations'][0]['country'].get('city', {}).get('name', 'unknown')
                servers_by_location.setdefault(country, {}).setdefault(city, {"distance": int(server['distance']), "servers": []})
                servers_by_location[country][city]["servers"].append((server['name'], server['load']))
            except:
                continue

        # Sort servers within each location by load
        for country in servers_by_location:
            for city in servers_by_location[country]:
                servers_by_location[country][city]["servers"].sort(key=lambda x: x[1])

        # Save best configs
        Path('best_configs').mkdir(parents=True, exist_ok=True)
        best_tasks = []
        for country, cities in servers_by_location.items():
            for city, data in cities.items():
                if not data["servers"]:
                    continue
                best_server_name = data["servers"][0][0]
                best_server_info = next((server for server in sorted_servers if server['name'] == best_server_name), None)
                if best_server_info:
                    best_tasks.append(asyncio.create_task(save_best_config(key, best_server_info, semaphore)))

        best_saved_results = await asyncio.gather(*best_tasks, return_exceptions=True)
        best_saved_count = sum(1 for result in best_saved_results if result is True)

        # Save servers.json
        try:
            servers_by_location_sorted = dict(sorted(servers_by_location.items()))
            async with aiofiles.open('servers.json', 'w') as f:
                await f.write(json.dumps(servers_by_location_sorted, indent=2))
        except:
            pass

    end_time = time.time()
    # Minimal summary logging
    print(f"Configs saved: {saved_count}, Best configs saved: {best_saved_count}")
    print(f"Process completed in {end_time - start_time:.2f} seconds")

if __name__ == "__main__":
    asyncio.run(main())
