import sys
import subprocess
import os
from typing import List, Tuple, Optional, Dict, Any

def clear_console():
    os.system('cls' if os.name == 'nt' else 'clear')

def ensure_dependencies():
    """Check and install required packages if missing."""
    required = {
        'aiohttp': 'aiohttp',
        'aiofiles': 'aiofiles'
    }
    
    missing = []
    for module, package in required.items():
        try:
            __import__(module)
        except ImportError:
            missing.append(package)
    
    if missing:
        print("Installing required packages...")
        try:
            subprocess.check_call([
                sys.executable, 
                "-m", 
                "pip", 
                "install", 
                "--disable-pip-version-check",
                "--quiet",
                *missing
            ])
        except subprocess.CalledProcessError as e:
            print(f"Error installing packages: {e}")
            sys.exit(1)

if __name__ == "__main__":
    ensure_dependencies()
    clear_console()
    
    # Standard library imports
    import asyncio
    import json
    import base64
    import re
    import logging
    from dataclasses import dataclass
    from pathlib import Path
    from math import radians, sin, cos, asin, sqrt
    from functools import partial
    from concurrent.futures import ThreadPoolExecutor
    from datetime import datetime
    import time

    # Third party imports
    import aiohttp
    import aiofiles

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    @dataclass
    class Server:
        name: str
        hostname: str
        station: str
        load: int
        country: str
        city: str
        latitude: float
        longitude: float
        public_key: str
        distance: float = 0

    @dataclass
    class UserConfig:
        dns: str = "103.86.96.100"
        use_ip: bool = False
        keepalive: int = 25

    def get_user_preferences() -> UserConfig:
        config = UserConfig()
        
        print("\nConfiguration Options (press Enter to use defaults)")
        
        dns = input("Enter DNS server IP (default: 103.86.96.100): ").strip()
        if dns and re.match(r'^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$', dns):
            config.dns = dns
        
        endpoint_type = input("Use IP instead of hostname for endpoints? (y/N): ").strip().lower()
        config.use_ip = endpoint_type == 'y'
        
        keepalive = input("Enter PersistentKeepalive value (default: 25): ").strip()
        if keepalive.isdigit() and 15 <= int(keepalive) <= 120:
            config.keepalive = int(keepalive)
        
        return config

    def calculate_distance(ulat: float, ulon: float, slat: float, slon: float) -> float:
        ulon, ulat, slon, slat = map(radians, [ulon, ulat, slon, slat])
        dlon, dlat = slon - ulon, slat - ulat
        a = sin(dlat/2)**2 + cos(ulat) * cos(slat) * sin(dlon/2)**2
        return 2 * asin(sqrt(a)) * 6371

    def parse_server(server_data: dict, user_location: Tuple[float, float]) -> Optional[Server]:
        try:
            ulat, ulon = user_location
            location = server_data['locations'][0]
            
            public_key = next(
                (data['value'] for tech in server_data.get('technologies', [])
                if tech['identifier'] == 'wireguard_udp'
                for data in tech['metadata']
                if data['name'] == 'public_key'),
                None
            )
            
            if not public_key:
                return None

            distance = calculate_distance(
                ulat, ulon,
                location['latitude'],
                location['longitude']
            )

            return Server(
                name=server_data['name'],
                hostname=server_data['hostname'],
                station=server_data['station'],
                load=int(server_data.get('load', 0)),
                country=location['country']['name'],
                city=location['country'].get('city', {}).get('name', 'unknown'),
                latitude=location['latitude'],
                longitude=location['longitude'],
                public_key=public_key,
                distance=distance
            )
        except (KeyError, IndexError):
            return None

    def is_valid_token(token: str) -> bool:
        return bool(re.match(r'^[a-fA-F0-9]{64}$', token))

    class NordVPNConfigGenerator:
        def __init__(self, concurrent_limit: int = 200):
            self.semaphore = asyncio.Semaphore(concurrent_limit)
            self.thread_pool = ThreadPoolExecutor(max_workers=min(32, concurrent_limit))
            self.output_dir = None
            self.user_config = None

        def _initialize_output_directory(self):
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            self.output_dir = Path(f'nordvpn_configs_{timestamp}')
            self.output_dir.mkdir(exist_ok=True)
            logging.info(f"Created output directory: {self.output_dir}")

        async def generate_configs(self, token: str, user_config: UserConfig):
            self.user_config = user_config
            if not is_valid_token(token):
                logging.error("Invalid token format. Expected 64 character hex string.")
                return

            logging.info("Starting configuration generation...")
            async with aiohttp.ClientSession() as session:
                logging.info("Validating credentials...")
                key = await self._get_private_key(session, token)
                if not key:
                    logging.error("Failed to get private key. Invalid token or API error.")
                    return

                self._initialize_output_directory()

                logging.info("Fetching server list...")
                servers = await self._get_servers(session)
                if not servers:
                    logging.error("Failed to get servers")
                    return
                logging.info(f"Found {len(servers)} servers")

                logging.info("Getting current location...")
                location = await self._get_location(session)
                if not location:
                    logging.error("Failed to get location")
                    return
                logging.info(f"Current location: {location}")

                await self._process_and_save(key, servers, location)
                
            logging.info(f"All configurations have been saved to: {self.output_dir}")

        async def _get_private_key(self, session: aiohttp.ClientSession, token: str) -> Optional[str]:
            token_encoded = base64.b64encode(f'token:{token}'.encode()).decode()
            async with session.get(
                'https://api.nordvpn.com/v1/users/services/credentials',
                headers={'Authorization': f'Basic {token_encoded}'}
            ) as response:
                return (await response.json()).get('nordlynx_private_key') if response.status == 200 else None

        async def _get_servers(self, session: aiohttp.ClientSession) -> List[dict]:
            async with session.get(
                'https://api.nordvpn.com/v1/servers',
                params={'limit': 7000, 'filters[servers_technologies][identifier]': 'wireguard_udp'}
            ) as response:
                return await response.json() if response.status == 200 else []

        async def _get_location(self, session: aiohttp.ClientSession) -> Optional[Tuple[float, float]]:
            async with session.get('https://ipinfo.io/json') as response:
                if response.status == 200:
                    data = await response.json()
                    loc = data.get('loc', '').split(',')
                    return (float(loc[0]), float(loc[1])) if len(loc) == 2 else None
                return None

        def _generate_config(self, key: str, server: Server) -> str:
            endpoint = server.station if self.user_config.use_ip else server.hostname
            return f"""[Interface]
PrivateKey = {key}
Address = 10.5.0.2/16
DNS = {self.user_config.dns}

[Peer]
PublicKey = {server.public_key}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = {endpoint}:51820
PersistentKeepalive = {self.user_config.keepalive}"""

        async def _save_config(self, key: str, server: Server, base_path: str):
            config = self._generate_config(key, server)
            country = re.sub(r'[<>:"/\\|?*\0]', '', server.country.lower().replace(' ', '_'))
            city = re.sub(r'[<>:"/\\|?*\0]', '', server.city.lower().replace(' ', '_'))
            name = re.sub(r'[<>:"/\\|?*\0]', '', server.name.lower().replace(' ', '_').replace('#', ''))
            
            path = self.output_dir / base_path / country / city
            path.mkdir(parents=True, exist_ok=True)
            
            async with self.semaphore:
                async with aiofiles.open(path / f"{name}.conf", 'w') as f:
                    await f.write(config)

        async def _process_and_save(self, private_key: str, servers: List[dict], location: Tuple[float, float]):
            logging.info("Processing server information...")
            loop = asyncio.get_event_loop()
            parse_func = partial(parse_server, user_location=location)
            parse_tasks = [
                loop.run_in_executor(self.thread_pool, parse_func, server)
                for server in servers
            ]
            parsed_servers = [s for s in await asyncio.gather(*parse_tasks) if s]
            logging.info(f"Successfully processed {len(parsed_servers)} servers")
            
            sorted_servers = sorted(parsed_servers, key=lambda s: (s.load, s.distance))
            
            logging.info("Generating standard configurations...")
            save_tasks = [self._save_config(private_key, server, 'configs') for server in sorted_servers]
            await asyncio.gather(*save_tasks)
            
            logging.info("Generating optimized configurations...")
            best_servers = {}
            for server in sorted_servers:
                location_key = (server.country, server.city)
                if location_key not in best_servers or server.load < best_servers[location_key].load:
                    best_servers[location_key] = server
            
            best_save_tasks = [
                self._save_config(private_key, server, 'best_configs')
                for server in best_servers.values()
            ]
            await asyncio.gather(*best_save_tasks)
            
            logging.info("Saving server information...")
            servers_info = {}
            for server in sorted_servers:
                if server.country not in servers_info:
                    servers_info[server.country] = {}
                if server.city not in servers_info[server.country]:
                    servers_info[server.country][server.city] = {
                        "distance": int(server.distance),
                        "servers": []
                    }
                servers_info[server.country][server.city]["servers"].append(
                    (server.name, server.load)
                )
            
            async with aiofiles.open(self.output_dir / 'servers.json', 'w') as f:
                await f.write(json.dumps(
                    servers_info,
                    indent=2,
                    separators=(',', ':'),
                    ensure_ascii=False
                ))

    async def validate_token(token: str) -> Optional[str]:
        async with aiohttp.ClientSession() as session:
            token_encoded = base64.b64encode(f'token:{token}'.encode()).decode()
            async with session.get(
                'https://api.nordvpn.com/v1/users/services/credentials',
                headers={'Authorization': f'Basic {token_encoded}'}
            ) as response:
                return (await response.json()).get('nordlynx_private_key') if response.status == 200 else None

    async def main():
        print("\nNordVPN Configuration Generator")
        print("==============================")
        print("Please enter your access token (64 character hex string):")
        token = input().strip()
        clear_console()  # Clear console immediately after token input
        
        if not token:
            logging.error("No token provided")
            return

        if not is_valid_token(token):
            logging.error("Invalid token format")
            print("Token must be a 64 character hex string")
            return

        logging.info("Validating access token...")
        private_key = await validate_token(token)
        if not private_key:
            logging.error("Invalid token or API error. Could not retrieve private key.")
            return
        
        # Clear console again after validation to remove any potential token-related messages
        clear_console()
        logging.info("Token validated successfully!")
        
        user_config = get_user_preferences()
        
        start_time = time.time()
        generator = NordVPNConfigGenerator()
        await generator.generate_configs(token, user_config)
        elapsed_time = time.time() - start_time
        
        if generator.output_dir and generator.output_dir.exists():
            logging.info(f"Process completed in {elapsed_time:.2f} seconds")
        else:
            logging.error("Process failed - no configurations were generated")

    if __name__ == "__main__":
        asyncio.run(main())
