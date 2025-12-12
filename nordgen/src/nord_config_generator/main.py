import sys
import os
import asyncio
import json
import base64
import time
from typing import List, Tuple, Optional, Dict, Any
from dataclasses import dataclass
from pathlib import Path
from math import radians, sin, cos, asin, sqrt
from functools import partial
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import aiohttp
import aiofiles

from .ui import ConsoleManager

@dataclass
class Server:
    name: str
    hostname: str
    station: str
    load: int
    country: str
    country_code: str
    city: str
    latitude: float
    longitude: float
    public_key: str
    distance: float = 0.0

@dataclass
class UserPreferences:
    dns: str = "103.86.96.100"
    use_ip_for_endpoint: bool = False
    persistent_keepalive: int = 25

@dataclass
class GenerationStats:
    total_configs: int = 0
    best_configs: int = 0

class NordVpnApiClient:
    NORD_API_BASE_URL = "https://api.nordvpn.com/v1"
    LOCATION_API_URL = "https://ipinfo.io/json"

    def __init__(self, console_manager: ConsoleManager):
        self._console = console_manager
        self._session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        self._session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session:
            await self._session.close()

    async def get_private_key(self, token: str) -> Optional[str]:
        auth_header = base64.b64encode(f'token:{token}'.encode()).decode()
        url = f"{self.NORD_API_BASE_URL}/users/services/credentials"
        headers = {'Authorization': f'Basic {auth_header}'}
        data = await self._get(url, headers=headers)
        if isinstance(data, dict):
            return data.get('nordlynx_private_key')
        return None

    async def get_all_servers(self) -> List[Dict[str, Any]]:
        url = f"{self.NORD_API_BASE_URL}/servers"
        params = {'limit': 16384, 'filters[servers_technologies][identifier]': 'wireguard_udp'}
        data = await self._get(url, params=params)
        return data if isinstance(data, list) else []

    async def get_user_geolocation(self) -> Optional[Tuple[float, float]]:
        data = await self._get(self.LOCATION_API_URL)
        if not isinstance(data, dict):
            return None
        try:
            lat, lon = data.get('loc', '').split(',')
            return float(lat), float(lon)
        except (ValueError, IndexError):
            self._console.print_message("error", "Could not parse location data.")
            return None

    async def _get(self, url: str, **kwargs) -> Optional[Any]:
        if not self._session:
            return None
        try:
            async with self._session.get(url, **kwargs) as response:
                response.raise_for_status()
                return await response.json()
        except (aiohttp.ClientError, json.JSONDecodeError) as e:
            self._console.print_message("error", f"API request failed for {url}: {e}")
            return None

class ConfigurationOrchestrator:
    CONCURRENT_LIMIT = 200
    _path_sanitizer = str.maketrans('', '', '<>:"/\\|?*\0')

    def __init__(self, private_key: str, preferences: UserPreferences, console_manager: ConsoleManager, api_client: NordVpnApiClient):
        self._private_key = private_key
        self._preferences = preferences
        self._console = console_manager
        self._api_client = api_client
        self._output_dir = Path(f'nordvpn_configs_{datetime.now().strftime("%Y%m%d_%H%M%S")}')
        self._semaphore = asyncio.Semaphore(self.CONCURRENT_LIMIT)
        self.stats = GenerationStats()

    async def generate(self) -> Optional[Path]:
        user_location, all_servers_data = await self._fetch_remote_data()
        if not user_location or not all_servers_data:
            return None

        processed_servers = await self._process_server_data(all_servers_data, user_location)
        
        unique_servers = {}
        for s in processed_servers:
            if s.name not in unique_servers:
                unique_servers[s.name] = s
        processed_servers = list(unique_servers.values())
        
        sorted_servers = sorted(processed_servers, key=lambda s: (s.load, s.distance))
        best_servers_by_location = self._get_best_servers(sorted_servers)
        
        self._output_dir.mkdir(exist_ok=True)
        servers_info = self._build_servers_info(sorted_servers)
        
        await self._save_all_configurations(sorted_servers, best_servers_by_location, servers_info)
        return self._output_dir

    async def _fetch_remote_data(self) -> Tuple[Optional[Tuple[float, float]], List[Dict[str, Any]]]:
        with self._console.create_progress_bar() as progress:
            task = progress.add_task("Fetching remote data...", total=2)
            user_location, all_servers_data = await asyncio.gather(
                self._api_client.get_user_geolocation(),
                self._api_client.get_all_servers()
            )
            progress.update(task, advance=2)
        return user_location, all_servers_data

    async def _process_server_data(self, all_servers_data: List[Dict[str, Any]], user_location: Tuple[float, float]) -> List[Server]:
        loop = asyncio.get_running_loop()
        parse_func = partial(self._parse_server_data, user_location=user_location)
        with ThreadPoolExecutor(max_workers=min(32, (os.cpu_count() or 1) + 4)) as executor:
            tasks = [loop.run_in_executor(executor, parse_func, s) for s in all_servers_data]
            processed_servers = await asyncio.gather(*tasks)
        return [server for server in processed_servers if server]

    def _get_best_servers(self, sorted_servers: List[Server]) -> Dict[Tuple[str, str], Server]:
        best = {}
        for server in sorted_servers:
            key = (server.country, server.city)
            if key not in best or server.load < best[key].load:
                best[key] = server
        return best

    def _build_servers_info(self, sorted_servers: List[Server]) -> Dict:
        info = {}
        for server in sorted_servers:
            country_info = info.setdefault(server.country, {})
            city_info = country_info.setdefault(server.city, {"distance": int(server.distance), "servers": []})
            city_info["servers"].append((server.name, server.load))
        return info

    async def _save_all_configurations(self, sorted_servers: List[Server], best_servers: Dict, servers_info: Dict):
        used_paths: Dict[str, int] = {}
        
        with self._console.create_progress_bar(transient=False) as progress:
            self.stats.total_configs = len(sorted_servers)
            self.stats.best_configs = len(best_servers)

            task_all = progress.add_task("Generating standard configs...", total=self.stats.total_configs)
            task_best = progress.add_task("Generating optimized configs...", total=self.stats.best_configs)
            
            save_tasks = []
            save_tasks.extend(self._create_batch_save_tasks(sorted_servers, 'configs', progress, task_all, used_paths))
            save_tasks.extend(self._create_batch_save_tasks(list(best_servers.values()), 'best_configs', progress, task_best, used_paths))
            
            await asyncio.gather(*save_tasks)
            async with aiofiles.open(self._output_dir / 'servers.json', 'w') as f:
                await f.write(json.dumps(servers_info, indent=2, separators=(',', ':'), ensure_ascii=False))

    def _create_batch_save_tasks(self, servers: List[Server], subfolder: str, progress, task_id, used_paths: Dict[str, int]):
        tasks = []
        for server in servers:
            country_clean = self._sanitize_path_part(server.country)
            city_clean = self._sanitize_path_part(server.city)
            dir_path = self._output_dir / subfolder / country_clean / city_clean
            
            base_filename = self._extract_base_filename(server)
            rel_path = f"{subfolder}/{country_clean}/{city_clean}/{base_filename}"
            
            if rel_path in used_paths:
                idx = used_paths[rel_path]
                if idx == 0: idx = 1
                
                base_path_no_ext = rel_path[:-5]
                base_name_no_ext = base_filename[:-5]
                
                while True:
                    new_rel = f"{base_path_no_ext}_{idx}.conf"
                    if new_rel not in used_paths:
                        used_paths[rel_path] = idx + 1
                        used_paths[new_rel] = 0
                        filename = f"{base_name_no_ext}_{idx}.conf"
                        break
                    idx += 1
            else:
                filename = base_filename
                used_paths[rel_path] = 0

            config_str = self._generate_wireguard_config_string(server, self._preferences, self._private_key)
            tasks.append(self._save_config_file(config_str, dir_path, filename, progress, task_id))
        return tasks

    async def _save_config_file(self, config_string: str, path: Path, filename: str, progress, task_id):
        path.mkdir(parents=True, exist_ok=True)
        async with self._semaphore:
            async with aiofiles.open(path / filename, 'w') as f:
                await f.write(config_string)
        progress.update(task_id, advance=1)

    @staticmethod
    def _extract_base_filename(server: Server) -> str:
        s = server.name
        num = ""
        for i in range(len(s) - 1, -1, -1):
            if s[i].isdigit():
                start = i
                while start >= 0 and s[start].isdigit():
                    start -= 1
                num = s[start+1 : i+1]
                break
        
        if not num:
            fallback = f"wg{server.station.replace('.', '')}"
            return f"{fallback[:15]}.conf"
        
        base = f"{server.country_code}{num}"
        return f"{base[:15]}.conf"

    @staticmethod
    def _generate_wireguard_config_string(server: Server, preferences: UserPreferences, private_key: str) -> str:
        endpoint = server.station if preferences.use_ip_for_endpoint else server.hostname
        return f"[Interface]\nPrivateKey = {private_key}\nAddress = 10.5.0.2/16\nDNS = {preferences.dns}\n\n[Peer]\nPublicKey = {server.public_key}\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = {endpoint}:51820\nPersistentKeepalive = {preferences.persistent_keepalive}"

    @staticmethod
    def _parse_server_data(server_data: Dict[str, Any], user_location: Tuple[float, float]) -> Optional[Server]:
        try:
            location = server_data['locations'][0]
            country_info = location['country']
            
            public_key = next(
                m['value'] for t in server_data['technologies']
                if t['identifier'] == 'wireguard_udp'
                for m in t['metadata'] if m['name'] == 'public_key'
            )
            distance = ConfigurationOrchestrator._calculate_distance(
                user_location[0], user_location[1], location['latitude'], location['longitude']
            )
            return Server(
                name=server_data['name'], hostname=server_data['hostname'],
                station=server_data['station'], load=int(server_data.get('load', 0)),
                country=country_info['name'], country_code=country_info['code'].lower(),
                city=country_info.get('city', {}).get('name', 'Unknown'),
                latitude=location['latitude'], longitude=location['longitude'],
                public_key=public_key, distance=distance
            )
        except (KeyError, IndexError, StopIteration):
            return None

    @staticmethod
    def _calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        lon1_rad, lat1_rad, lon2_rad, lat2_rad = map(radians, [lon1, lat1, lon2, lat2])
        dlon = lon2_rad - lon1_rad
        dlat = lat2_rad - lat1_rad
        a = sin(dlat / 2)**2 + cos(lat1_rad) * cos(lat2_rad) * sin(dlon / 2)**2
        c = 2 * asin(sqrt(a))
        return c * 6371

    @classmethod
    def _sanitize_path_part(cls, part: str) -> str:
        return part.lower().replace(' ', '_').replace('#', '').translate(cls._path_sanitizer)

class Application:
    def __init__(self):
        self._console = ConsoleManager()

    async def run(self, args: List[str]):
        async with NordVpnApiClient(self._console) as api_client:
            try:
                if not args:
                    await self._run_generate_command(api_client)
                elif args[0] == "get-key" and len(args) == 1:
                    await self._run_get_key_command(api_client)
                else:
                    command = " ".join(args)
                    self._console.print_message("error", f"Unknown command or invalid arguments: '{command}'.")
                    self._console.print_message("info", "Usage: nordgen | nordgen get-key")
            except Exception as e:
                self._console.print_message("error", f"An unrecoverable error occurred: {e}")

    async def _run_get_key_command(self, api_client: NordVpnApiClient):
        self._console.clear()
        self._console.print_title()
        private_key = await self._get_validated_private_key(api_client)
        if private_key:
            self._console.display_key(private_key)

    async def _run_generate_command(self, api_client: NordVpnApiClient):
        self._console.clear()
        self._console.print_title()
        private_key = await self._get_validated_private_key(api_client)
        if not private_key:
            return

        preferences = self._collect_user_preferences()
        
        self._console.clear()
        
        start_time = time.time()
        orchestrator = ConfigurationOrchestrator(private_key, preferences, self._console, api_client)
        output_dir = await orchestrator.generate()
        elapsed_time = time.time() - start_time
        
        if output_dir:
            self._console.display_summary(output_dir, orchestrator.stats, elapsed_time)
        else:
            self._console.print_message("error", "Process failed. Check logs for details.")

    def _collect_user_preferences(self) -> UserPreferences:
        defaults = UserPreferences()
        user_input = self._console.get_preferences(defaults)

        dns_input = user_input.get("dns")
        if dns_input:
            parts = dns_input.split('.')
            if len(parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts):
                defaults.dns = dns_input
        
        use_ip = user_input.get("endpoint_type", "").lower() == 'y'

        keepalive_input = user_input.get("keepalive")
        if keepalive_input and keepalive_input.isdigit():
            keepalive_val = int(keepalive_input)
            if 15 <= keepalive_val <= 120:
                defaults.persistent_keepalive = keepalive_val
        
        return UserPreferences(
            dns=defaults.dns,
            use_ip_for_endpoint=use_ip,
            persistent_keepalive=defaults.persistent_keepalive
        )

    async def _get_validated_private_key(self, api_client: NordVpnApiClient) -> Optional[str]:
        token = self._console.get_user_input("Please enter your NordVPN access token: ", is_secret=True)
        is_hex = len(token) == 64 and all(c in '0123456789abcdefABCDEF' for c in token)
        if not is_hex:
            self._console.print_message("error", "Invalid token format.")
            return None
        
        with self._console.create_progress_bar() as progress:
            task = progress.add_task("Validating token...", total=1)
            private_key = await api_client.get_private_key(token)
            progress.update(task, advance=1)
        
        if private_key:
            self._console.print_message("success", "Token validated successfully.")
            return private_key
        else:
            self._console.print_message("error", "Token is invalid or could not be verified.")
            return None

def cli_entry_point():
    try:
        app = Application()
        asyncio.run(app.run(sys.argv[1:]))
    except KeyboardInterrupt:
        print("\nProcess interrupted by user.")

if __name__ == "__main__":
    cli_entry_point()