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

# Platform-specific imports for password input with dots
if sys.platform == 'win32':
    import msvcrt
else:
    import termios
    import tty

@dataclass
class Server:
    name: str
    hostname: str
    station: str
    load: int
    country: str
    country_code: str
    city: str
    region: str  # "Europe", "The_Americas", "Asia_Pacific", etc.
    server_type: str  # "Standard", "P2P", "Dedicated_IP", "Double_VPN", etc.
    latitude: float
    longitude: float
    public_key: str
    distance: float = 0.0

@dataclass
class UserPreferences:
    dns: str = "103.86.96.100"  # NordVPN CyberSec DNS (official, blocks ads & malware)
    use_ip_for_endpoint: bool = False
    persistent_keepalive: int = 25
    # Server filtering options
    server_types: Optional[List[str]] = None  # ["legacy_p2p", "legacy_standard", ...] or None for all types
    regions: Optional[List[str]] = None  # ["europe", "the_americas", ...] or None for all
    countries: Optional[List[str]] = None  # ["France", "Germany"] or None for all
    cities: Optional[List[str]] = None  # ["Paris", "Berlin"] or None for all
    max_load: int = 100  # Maximum server load percentage (0-100)

@dataclass
class GenerationStats:
    total_configs: int = 0
    best_configs: int = 0

@dataclass
class ServerMetadata:
    """Metadata from API for dynamic menus"""
    regions: List[Dict[str, str]]  # [{"id": "europe", "name": "Europe"}, ...]
    server_types: List[Dict[str, str]]  # [{"id": "legacy_p2p", "name": "P2P"}, ...]
    countries: List[Dict[str, str]]  # [{"id": "France", "name": "France", "code": "FR"}, ...]
    cities: List[Dict[str, str]]  # [{"name": "Paris", "country": "France"}, ...] - extracted from servers
    type_priority: List[str]  # Priority order for determining primary server type (most specific first)

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
        params = {
            'limit': 16384,
            'filters[servers_technologies][identifier]': 'wireguard_udp',
            'filters[servers_status]': 'online'
        }
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

    async def get_groups(self) -> List[Dict[str, Any]]:
        """Fetch all server groups (regions, server types, etc.)"""
        url = f"{self.NORD_API_BASE_URL}/servers/groups"
        data = await self._get(url)
        return data if isinstance(data, list) else []

    async def get_countries(self) -> List[Dict[str, Any]]:
        """Fetch all available countries"""
        url = f"{self.NORD_API_BASE_URL}/servers/countries"
        data = await self._get(url)
        return data if isinstance(data, list) else []

    async def build_metadata(self, servers: List[Dict[str, Any]]) -> ServerMetadata:
        """Build metadata from API data for dynamic menus"""
        # Fetch groups data for server types and region name mapping
        groups_data = await self.get_groups()

        # Build region ID to name mapping from groups
        region_keywords = ['europe', 'america', 'asia', 'africa']
        region_id_to_name = {}
        for group in groups_data:
            identifier = group.get('identifier', '')
            if any(keyword in identifier for keyword in region_keywords):
                region_id_to_name[identifier] = group.get('title', identifier)

        # Extract regions from filtered servers (not from all groups)
        # This ensures we only show regions that have servers in the filtered set
        region_ids_in_servers = set()
        for server in servers:
            server_groups = server.get('groups', [])
            for group in server_groups:
                identifier = group.get('identifier', '')
                if any(keyword in identifier for keyword in region_keywords):
                    region_ids_in_servers.add(identifier)

        # Build regions list with names
        regions = []
        for region_id in sorted(region_ids_in_servers):
            regions.append({
                'id': region_id,
                'name': region_id_to_name.get(region_id, region_id)
            })

        # Extract ALL server types dynamically (legacy_*)
        legacy_types = []
        for group in groups_data:
            identifier = group.get('identifier', '')
            if identifier.startswith('legacy_'):
                legacy_types.append({
                    'id': identifier,
                    'name': group.get('title', identifier)
                })

        # Calculate type priority based on rarity (count servers per type)
        type_counts = {}
        for server in servers:
            groups = server.get('groups', [])
            for group in groups:
                identifier = group.get('identifier', '')
                if identifier.startswith('legacy_'):
                    type_counts[identifier] = type_counts.get(identifier, 0) + 1

        # Sort types by count (rarest first = most specific)
        # Exception: legacy_standard always goes last (least specific)
        type_priority = sorted(
            [t for t in type_counts.keys() if t != 'legacy_standard'],
            key=lambda t: type_counts[t]
        )
        if 'legacy_standard' in type_counts:
            type_priority.append('legacy_standard')

        # Build server types menu with "all" option first, enriched with counts
        # Calculate total for "all" (includes all types)
        all_count = sum(type_counts.values())
        server_types = [{'id': 'all', 'name': 'All servers', 'count': all_count}]

        # Add counts to legacy types
        for legacy_type in legacy_types:
            legacy_type['count'] = type_counts.get(legacy_type['id'], 0)

        server_types.extend(legacy_types)

        # Extract countries directly from filtered servers (not from API)
        # This ensures we only show countries that have servers in the filtered set
        country_info_map = {}
        country_to_regions = {}
        for server in servers:
            server_groups = server.get('groups', [])
            location = server.get('locations', [{}])[0]
            country_data = location.get('country', {})
            country_name = country_data.get('name')
            country_code = country_data.get('code')

            if country_name and country_code:
                # Store country info
                if country_name not in country_info_map:
                    country_info_map[country_name] = country_code

                # Find region groups for this server
                for group in server_groups:
                    identifier = group.get('identifier', '')
                    if any(keyword in identifier for keyword in region_keywords):
                        if country_name not in country_to_regions:
                            country_to_regions[country_name] = set()
                        country_to_regions[country_name].add(identifier)

        # Format countries with their regions (only countries from filtered servers)
        countries = []
        for country_name, country_code in sorted(country_info_map.items()):
            country_regions = list(country_to_regions.get(country_name, []))
            countries.append({
                'id': country_name,
                'name': country_name,
                'code': country_code,
                'regions': country_regions  # List of region identifiers this country belongs to
            })

        # Extract cities from servers (with country info)
        cities_set = set()
        for server in servers:
            for location in server.get('locations', []):
                country_info = location.get('country', {})
                city_info = country_info.get('city', {})
                city_name = city_info.get('name')
                country_name = country_info.get('name')
                if city_name and country_name:
                    cities_set.add((city_name, country_name))

        cities = [{'name': city, 'country': country}
                 for city, country in sorted(cities_set)]

        return ServerMetadata(
            regions=regions,
            server_types=server_types,
            countries=countries,
            cities=cities,
            type_priority=type_priority
        )

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

    def __init__(self, private_key: str, preferences: UserPreferences, console_manager: ConsoleManager, api_client: NordVpnApiClient, type_priority: Optional[List[str]] = None):
        self._private_key = private_key
        self._preferences = preferences
        self._console = console_manager
        self._api_client = api_client
        self._type_priority = type_priority or []
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
        parse_func = partial(self._parse_server_data, user_location=user_location, preferences=self._preferences, type_priority=self._type_priority)
        with ThreadPoolExecutor(max_workers=min(32, (os.cpu_count() or 1) + 4)) as executor:
            tasks = [loop.run_in_executor(executor, parse_func, s) for s in all_servers_data]
            processed_servers = await asyncio.gather(*tasks)
        return [server for server in processed_servers if server]

    def _get_best_servers(self, sorted_servers: List[Server]) -> Dict[Tuple[str, str, str], Server]:
        best = {}
        for server in sorted_servers:
            key = (server.country, server.city, server.server_type)
            if key not in best or server.load < best[key].load:
                best[key] = server
        return best

    def _build_servers_info(self, sorted_servers: List[Server]) -> Dict:
        """Build hierarchical server info: Type -> Region -> Country -> City"""
        info = {}
        for server in sorted_servers:
            type_info = info.setdefault(server.server_type, {})
            region_info = type_info.setdefault(server.region, {})
            country_info = region_info.setdefault(server.country, {})
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
            type_clean = self._sanitize_path_part(server.server_type)
            region_clean = self._sanitize_path_part(server.region)
            country_clean = self._sanitize_path_part(server.country)
            city_clean = self._sanitize_path_part(server.city)
            dir_path = self._output_dir / subfolder / type_clean / region_clean / country_clean / city_clean

            base_filename = self._extract_base_filename(server)
            rel_path = f"{subfolder}/{type_clean}/{region_clean}/{country_clean}/{city_clean}/{base_filename}"
            
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

        # Sanitize server type for filename (remove spaces, keep underscores)
        type_clean = server.server_type.replace(' ', '_')

        if not num:
            fallback = f"wg{server.station.replace('.', '')}"
            return f"{fallback[:15]}_{type_clean}.conf"

        base = f"{server.country_code}{num}"
        return f"{base[:15]}_{type_clean}.conf"

    @staticmethod
    def _generate_wireguard_config_string(server: Server, preferences: UserPreferences, private_key: str) -> str:
        endpoint = server.station if preferences.use_ip_for_endpoint else server.hostname
        return f"[Interface]\nPrivateKey = {private_key}\nAddress = 10.5.0.2/16\nDNS = {preferences.dns}\n\n[Peer]\nPublicKey = {server.public_key}\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = {endpoint}:51820\nPersistentKeepalive = {preferences.persistent_keepalive}"

    @staticmethod
    def _determine_server_type(group_identifiers: set, type_priority: Optional[List[str]] = None, user_selected_types: Optional[List[str]] = None) -> str:
        """Determine the primary server type from group identifiers using dynamic priority

        Args:
            group_identifiers: Set of group identifiers from server
            type_priority: Priority list for all types (rarest first)
            user_selected_types: Types selected by user (if any) - only consider these types
        """
        def format_type_name(type_id: str) -> str:
            """Format legacy type ID to display name (e.g., legacy_double_vpn -> Double_VPN)"""
            name = type_id.replace('legacy_', '')
            # Split by underscore, format each word (acronyms in uppercase, others capitalize)
            words = []
            for word in name.split('_'):
                # If word is 2-3 letters, treat as acronym and uppercase
                if len(word) <= 3:
                    words.append(word.upper())
                else:
                    words.append(word.capitalize())
            return '_'.join(words)

        # Filter to only legacy_ types
        legacy_types = {g for g in group_identifiers if g.startswith('legacy_')}

        # If user selected specific types, only consider those
        if user_selected_types:
            legacy_types = {t for t in legacy_types if t in user_selected_types}

        if not legacy_types:
            return "Other"

        # Use dynamic priority if provided
        if type_priority:
            # Return the first type from priority list that exists in this server's groups
            for type_id in type_priority:
                if type_id in legacy_types:
                    return format_type_name(type_id)

        # Fallback: return any legacy type found
        first_type = next(iter(legacy_types))
        return format_type_name(first_type)

    @staticmethod
    def _parse_server_data(server_data: Dict[str, Any], user_location: Tuple[float, float], preferences: UserPreferences, type_priority: Optional[List[str]] = None) -> Optional[Server]:
        try:
            server_groups = server_data.get('groups', [])
            group_identifiers = {g.get('identifier') for g in server_groups}

            # Filter by server types (can be multiple)
            if preferences.server_types is not None:
                # Check if server matches ANY of the requested types
                type_match = False
                for selected_type in preferences.server_types:
                    # For legacy types (standard, p2p, dedicated_ip), map old names for backward compatibility
                    type_mapping = {
                        "standard": "legacy_standard",
                        "p2p": "legacy_p2p",
                        "dedicated_ip": "legacy_dedicated_ip"
                    }
                    target_type = type_mapping.get(selected_type, selected_type)

                    if target_type in group_identifiers:
                        type_match = True
                        break

                if not type_match:
                    return None
            # If preferences.server_types is None, include all server types (no filtering)

            # Filter by region
            if preferences.regions:
                region_match = any(region in group_identifiers for region in preferences.regions)
                if not region_match:
                    return None

            # Filter by load
            server_load = int(server_data.get('load', 0))
            if server_load > preferences.max_load:
                return None

            location = server_data['locations'][0]
            country_info = location['country']

            # Filter by country
            if preferences.countries:
                if country_info['name'] not in preferences.countries:
                    return None

            # Filter by city
            city_name = country_info.get('city', {}).get('name', 'Unknown')
            if preferences.cities:
                if city_name not in preferences.cities:
                    return None

            # Extract WireGuard public key from metadata
            public_key = next(
                m['value'] for t in server_data['technologies']
                if t['identifier'] == 'wireguard_udp'
                for m in t['metadata'] if m['name'] == 'public_key'
            )

            distance = ConfigurationOrchestrator._calculate_distance(
                user_location[0], user_location[1], location['latitude'], location['longitude']
            )

            # Determine server type using dynamic priority
            # If user selected specific types, only consider those for labeling
            server_type = ConfigurationOrchestrator._determine_server_type(
                group_identifiers, type_priority, preferences.server_types
            )

            # Extract region from group identifiers
            region_keywords = ['europe', 'america', 'asia', 'africa']
            region = "Unknown"
            for group_id in group_identifiers:
                if any(keyword in group_id for keyword in region_keywords):
                    # Format region name (e.g., "the_americas" -> "The_Americas")
                    region = '_'.join(word.capitalize() for word in group_id.split('_'))
                    break

            return Server(
                name=server_data['name'], hostname=server_data['hostname'],
                station=server_data['station'], load=server_load,
                country=country_info['name'], country_code=country_info['code'].lower(),
                city=country_info.get('city', {}).get('name', 'Unknown'),
                region=region,
                server_type=server_type,
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

        # Load metadata for server types menu
        self._console.print_message("info", "Loading server metadata...")
        servers_data = await api_client.get_all_servers()
        if not servers_data:
            self._console.print_message("error", "Failed to load servers from API.")
            return

        metadata = await api_client.build_metadata(servers_data)
        self._console.print_message("success",
            f"Loaded {len(servers_data)} servers: {len(metadata.countries)} countries, "
            f"{len(metadata.regions)} regions, {len(metadata.cities)} cities")

        # === PHASE 1: Get connection settings and server type selection ===
        connection_and_type = None
        selected_types = None
        while True:
            connection_and_type = self._console.get_server_type_selection(UserPreferences(), metadata)
            selected_types = self._parse_server_types(connection_and_type["server_type"], metadata)

            # Validate selection
            if self._validate_server_types(selected_types, metadata):
                break
            # If invalid, loop to ask again

        # Filter servers by selected types
        self._console.print_message("info", "Filtering servers by selected types...")
        filtered_servers = self._filter_servers_by_types(servers_data, selected_types)

        # Rebuild metadata from filtered servers
        filtered_metadata = await api_client.build_metadata(filtered_servers)
        self._console.print_message("success",
            f"Filtered to {len(filtered_servers)} servers in {len(filtered_metadata.countries)} countries, "
            f"{len(filtered_metadata.regions)} regions, {len(filtered_metadata.cities)} cities")
        self._console.print_message("info", "Now select location filtering options...")

        # === PHASE 2: Get location preferences ===
        location_prefs = self._console.get_location_preferences(filtered_metadata)

        # Build final preferences (combine connection settings, type, and location)
        preferences = self._build_final_preferences(
            server_types=selected_types,
            connection_prefs=connection_and_type,
            location_prefs=location_prefs,
            metadata=filtered_metadata
        )

        self._console.clear()

        start_time = time.time()
        orchestrator = ConfigurationOrchestrator(private_key, preferences, self._console, api_client, metadata.type_priority)
        output_dir = await orchestrator.generate()
        elapsed_time = time.time() - start_time

        if output_dir:
            self._console.display_summary(output_dir, orchestrator.stats, elapsed_time)
        else:
            self._console.print_message("error", "Process failed. Check logs for details.")

    def _parse_server_types(self, server_type_input: str, metadata: ServerMetadata) -> Optional[List[str]]:
        """Parse server type selection and return list of type IDs

        Args:
            server_type_input: Raw user input (e.g., "3,4" or "2")
            metadata: Server metadata containing type information

        Returns:
            List of type IDs (e.g., ["legacy_p2p", "legacy_double_vpn"]) or None for "all"
        """
        server_type_input = server_type_input.strip()

        if not server_type_input:
            return None  # Empty input = all servers (includes all types)

        if metadata and metadata.server_types:
            # Parse comma-separated selections or single selection
            type_numbers = [n.strip() for n in server_type_input.split(',') if n.strip().isdigit()]
            if type_numbers:
                selected_types = []
                for num in type_numbers:
                    idx = int(num) - 1
                    if 0 <= idx < len(metadata.server_types):
                        type_id = metadata.server_types[idx]['id']
                        # "all" means None (includes all server types)
                        if type_id != 'all':
                            selected_types.append(type_id)

                # If no types selected or only "all" was selected, keep None (means all server types)
                if selected_types:
                    return selected_types
                return None
        elif server_type_input.isdigit():
            # Fallback to static mapping for single digit
            static_map = {"1": None, "2": ["legacy_standard"], "3": ["legacy_p2p"], "4": ["legacy_dedicated_ip"]}
            return static_map.get(server_type_input, None)

        return None

    @staticmethod
    def _filter_servers_by_types(servers_data: List[Dict[str, Any]], selected_types: Optional[List[str]]) -> List[Dict[str, Any]]:
        """Pre-filter raw server data by server types only

        Args:
            servers_data: List of raw server dicts from API
            selected_types: List of type IDs to filter by, or None for "all"

        Returns:
            Filtered list of server dicts
        """
        if selected_types is None:
            # None means "all" - return all servers without filtering
            return servers_data

        # Filter servers that match ANY of the selected types
        filtered = []
        for server in servers_data:
            groups = server.get('groups', [])
            group_ids = {g.get('identifier') for g in groups}

            # Type mapping for backward compatibility
            type_mapping = {
                "standard": "legacy_standard",
                "p2p": "legacy_p2p",
                "dedicated_ip": "legacy_dedicated_ip"
            }

            # Check if server matches any selected type
            for selected_type in selected_types:
                target_type = type_mapping.get(selected_type, selected_type)
                if target_type in group_ids:
                    filtered.append(server)
                    break  # Don't add the same server multiple times

        return filtered

    def _validate_server_types(self, selected_types: Optional[List[str]], metadata: ServerMetadata) -> bool:
        """Validate that selected server types have available servers

        Args:
            selected_types: List of type IDs, or None for "all"
            metadata: Server metadata containing type counts

        Returns:
            True if valid (has servers), False otherwise
        """
        if selected_types is None:
            return True  # "all" is always valid

        # Count total servers available for selected types
        total_count = 0
        for stype in metadata.server_types:
            if stype['id'] in selected_types:
                total_count += stype.get('count', 0)

        if total_count == 0:
            self._console.print_message("error",
                "These server types have no WireGuard servers available.")
            self._console.print_message("info",
                "Note: Netflix, Obfuscated and other special types only support OpenVPN, not WireGuard.")
            self._console.print_message("warning",
                "Please choose different server types.")
            return False

        return True

    def _build_final_preferences(self, server_types: Optional[List[str]], connection_prefs: dict, location_prefs: dict, metadata: ServerMetadata) -> UserPreferences:
        """Build final UserPreferences from parsed server types, connection and location preferences

        Args:
            server_types: Already parsed server types (from Phase 1)
            connection_prefs: Connection preferences dict (dns, endpoint_type, keepalive from Phase 1)
            location_prefs: Location preferences dict (regions, countries, cities from Phase 2)
            metadata: Filtered metadata for parsing

        Returns:
            Complete UserPreferences object
        """
        defaults = UserPreferences()

        # Parse DNS (from connection_prefs)
        dns_input = connection_prefs.get("dns")
        if dns_input:
            parts = dns_input.split('.')
            if len(parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts):
                defaults.dns = dns_input

        # Parse endpoint type (from connection_prefs)
        use_ip = connection_prefs.get("endpoint_type", "").lower() == 'y'

        # Parse keepalive (from connection_prefs)
        keepalive_input = connection_prefs.get("keepalive")
        if keepalive_input and keepalive_input.isdigit():
            keepalive_val = int(keepalive_input)
            if 15 <= keepalive_val <= 120:
                defaults.persistent_keepalive = keepalive_val

        # Parse regions (dynamic from metadata)
        regions_input = location_prefs.get("regions", "").strip()
        regions = None
        if regions_input and metadata and metadata.regions:
            region_numbers = [n.strip() for n in regions_input.split(',') if n.strip().isdigit()]
            regions = []
            for num in region_numbers:
                idx = int(num) - 1
                if 0 <= idx < len(metadata.regions):
                    regions.append(metadata.regions[idx]['id'])
            if not regions:
                regions = None

        # Parse countries (dynamic from metadata, using filtered list if available)
        countries_input = location_prefs.get("countries", "").strip()
        countries = None
        countries_list = location_prefs.get("filtered_countries") or (metadata.countries if metadata else None)

        if countries_input and countries_list:
            if countries_input.isdigit() or ',' in countries_input:
                # Numeric selection
                country_numbers = [n.strip() for n in countries_input.split(',') if n.strip().isdigit()]
                countries = []
                for num in country_numbers:
                    idx = int(num) - 1
                    if 0 <= idx < len(countries_list):
                        countries.append(countries_list[idx]['name'])
                if not countries:
                    countries = None
            else:
                # Text input (backward compatibility)
                countries = [c.strip() for c in countries_input.split(',') if c.strip()]
        elif countries_input:
            countries = [c.strip() for c in countries_input.split(',') if c.strip()]

        # Parse cities (using filtered list if available)
        cities_input = location_prefs.get("cities", "").strip()
        cities = None
        cities_list = location_prefs.get("filtered_cities") or (metadata.cities if metadata else None)

        if cities_input and cities_list:
            if cities_input.isdigit() or ',' in cities_input:
                # Numeric selection
                city_numbers = [n.strip() for n in cities_input.split(',') if n.strip().isdigit()]
                cities = []
                for num in city_numbers:
                    idx = int(num) - 1
                    if 0 <= idx < len(cities_list):
                        cities.append(cities_list[idx]['name'])
                if not cities:
                    cities = None
            else:
                # Text input (backward compatibility)
                cities = [c.strip() for c in cities_input.split(',') if c.strip()]
        elif cities_input:
            cities = [c.strip() for c in cities_input.split(',') if c.strip()]

        return UserPreferences(
            dns=defaults.dns,
            use_ip_for_endpoint=use_ip,
            persistent_keepalive=defaults.persistent_keepalive,
            server_types=server_types,  # Already parsed in Phase 1
            regions=regions,
            countries=countries,
            cities=cities,
            max_load=100  # No load filtering, accept all servers
        )

    def _collect_user_preferences(self, metadata: Optional[ServerMetadata] = None) -> UserPreferences:
        defaults = UserPreferences()
        user_input = self._console.get_preferences(defaults, metadata)

        # Parse DNS
        dns_input = user_input.get("dns")
        if dns_input:
            parts = dns_input.split('.')
            if len(parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts):
                defaults.dns = dns_input

        # Parse endpoint type
        use_ip = user_input.get("endpoint_type", "").lower() == 'y'

        # Parse keepalive
        keepalive_input = user_input.get("keepalive")
        if keepalive_input and keepalive_input.isdigit():
            keepalive_val = int(keepalive_input)
            if 15 <= keepalive_val <= 120:
                defaults.persistent_keepalive = keepalive_val

        # Parse server types (dynamic from metadata, can be multiple)
        server_type_input = user_input.get("server_type", "").strip()
        server_types = None
        if server_type_input and metadata and metadata.server_types:
            # Parse comma-separated selections or single selection
            type_numbers = [n.strip() for n in server_type_input.split(',') if n.strip().isdigit()]
            if type_numbers:
                selected_types = []
                for num in type_numbers:
                    idx = int(num) - 1
                    if 0 <= idx < len(metadata.server_types):
                        type_id = metadata.server_types[idx]['id']
                        # "all" means None (excludes dedicated IP by default)
                        if type_id != 'all':
                            selected_types.append(type_id)

                # If no types selected or only "all" was selected, keep None (means all except dedicated IP)
                if selected_types:
                    server_types = selected_types
        elif server_type_input and server_type_input.isdigit():
            # Fallback to static mapping for single digit
            static_map = {"1": None, "2": ["legacy_standard"], "3": ["legacy_p2p"], "4": ["legacy_dedicated_ip"]}
            server_types = static_map.get(server_type_input, None)

        # Parse regions (dynamic from metadata)
        regions_input = user_input.get("regions", "").strip()
        regions = None
        if regions_input and metadata and metadata.regions:
            region_numbers = [n.strip() for n in regions_input.split(',') if n.strip().isdigit()]
            regions = []
            for num in region_numbers:
                idx = int(num) - 1
                if 0 <= idx < len(metadata.regions):
                    regions.append(metadata.regions[idx]['id'])
            if not regions:
                regions = None

        # Parse countries (dynamic from metadata, using filtered list if available)
        countries_input = user_input.get("countries", "").strip()
        countries = None
        # Use filtered countries list if available (filtered by region selection)
        countries_list = user_input.get("filtered_countries") or (metadata.countries if metadata else None)

        if countries_input and countries_list:
            if countries_input.isdigit() or ',' in countries_input:
                # Numeric selection
                country_numbers = [n.strip() for n in countries_input.split(',') if n.strip().isdigit()]
                countries = []
                for num in country_numbers:
                    idx = int(num) - 1
                    if 0 <= idx < len(countries_list):
                        countries.append(countries_list[idx]['name'])
                if not countries:
                    countries = None
            else:
                # Text input (backward compatibility)
                countries = [c.strip() for c in countries_input.split(',') if c.strip()]
        elif countries_input:
            countries = [c.strip() for c in countries_input.split(',') if c.strip()]

        # Parse cities (using filtered list if available)
        cities_input = user_input.get("cities", "").strip()
        cities = None
        cities_list = user_input.get("filtered_cities") or (metadata.cities if metadata else None)

        if cities_input and cities_list:
            if cities_input.isdigit() or ',' in cities_input:
                # Numeric selection
                city_numbers = [n.strip() for n in cities_input.split(',') if n.strip().isdigit()]
                cities = []
                for num in city_numbers:
                    idx = int(num) - 1
                    if 0 <= idx < len(cities_list):
                        cities.append(cities_list[idx]['name'])
                if not cities:
                    cities = None
            else:
                # Text input (backward compatibility)
                cities = [c.strip() for c in cities_input.split(',') if c.strip()]
        elif cities_input:
            cities = [c.strip() for c in cities_input.split(',') if c.strip()]

        return UserPreferences(
            dns=defaults.dns,
            use_ip_for_endpoint=use_ip,
            persistent_keepalive=defaults.persistent_keepalive,
            server_types=server_types,
            regions=regions,
            countries=countries,
            cities=cities,
            max_load=100  # No load filtering, accept all servers
        )

    def _get_token_with_dots(self, prompt: str) -> str:
        """Get password input with dots displayed for each character"""
        self._console.console.print(f"[info]{prompt}[/info]", end='', highlight=False)

        token = []

        if sys.platform == 'win32':
            # Windows implementation using msvcrt
            while True:
                char = msvcrt.getwch()

                if char in ('\r', '\n'):  # Enter key
                    print()  # New line
                    break
                elif char == '\x03':  # Ctrl+C
                    print()
                    raise KeyboardInterrupt
                elif char == '\x08':  # Backspace
                    if token:
                        token.pop()
                        # Erase the last dot
                        print('\b \b', end='', flush=True)
                elif char == '\x16':  # Ctrl+V (paste on some systems)
                    # Handle paste - just add the character
                    token.append(char)
                    print('•', end='', flush=True)
                elif ord(char) >= 32:  # Printable character
                    token.append(char)
                    print('•', end='', flush=True)
        else:
            # Unix/Linux implementation using termios
            fd = sys.stdin.fileno()
            old_settings = termios.tcgetattr(fd)
            try:
                tty.setraw(fd)
                while True:
                    char = sys.stdin.read(1)

                    if char in ('\r', '\n'):  # Enter key
                        print()
                        break
                    elif char == '\x03':  # Ctrl+C
                        print()
                        raise KeyboardInterrupt
                    elif char in ('\x7f', '\x08'):  # Backspace/Delete
                        if token:
                            token.pop()
                            print('\b \b', end='', flush=True)
                    elif ord(char) >= 32:  # Printable character
                        token.append(char)
                        print('•', end='', flush=True)
            finally:
                termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)

        return ''.join(token).strip()

    async def _get_validated_private_key(self, api_client: NordVpnApiClient) -> Optional[str]:
        token = self._get_token_with_dots("Please enter your NordVPN access token: ")
        is_hex = len(token) == 64 and all(c in '0123456789abcdefABCDEF' for c in token)
        if not is_hex:
            self._console.print_message("error", "Invalid token format (must be 64 hexadecimal characters).")
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