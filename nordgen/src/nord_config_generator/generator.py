import asyncio
import os
import aiofiles
from typing import List, Dict, Optional, Set
from math import radians, sin, cos, asin, sqrt
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from rich.progress import TaskID

from .client import NordClient
from .ui import ConsoleManager
from .models import Server, UserPreferences, Stats

class Generator:
    MIN_VER_MAJOR = 2
    MIN_VER_MINOR = 1

    def __init__(self, client: NordClient, ui: ConsoleManager):
        self.client = client
        self.ui = ui
        self.stats = Stats()
        self.dir_cache: Set[str] = set()
        self.out_dir = Path(f'nordvpn_configs_{datetime.now().strftime("%Y%m%d_%H%M%S")}')
        self.path_sanitizer = str.maketrans('', '', '<>:"/\\|?*\0')

    async def process(self, key: str, prefs: UserPreferences):
        self.ui.spin("Fetching data...")
        
        geo_task = asyncio.create_task(self.client.get_geo())
        srv_task = asyncio.create_task(self.client.get_servers())
        
        lat, lon = await geo_task
        raw_servers = await srv_task
        
        if not raw_servers:
            self.ui.fail("Failed to fetch server data")
            return

        self.ui.success("Data fetched")
        self.ui.spin("Processing dataset...")

        loop = asyncio.get_running_loop()
        with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as pool:
            processed = await loop.run_in_executor(pool, self._parse_batch, raw_servers, lat, lon)

        unique = {s.name: s for s in processed}
        final_list = list(unique.values())
        final_list.sort(key=lambda x: (x.load, x.distance))
        
        self.stats.rejected = len(raw_servers) - len(final_list)
        self.stats.total = len(final_list)
        
        best_map = {}
        for s in final_list:
            k = (s.country, s.city)
            if k not in best_map or s.load < best_map[k].load:
                best_map[k] = s
        
        self.stats.best = len(best_map)
        best_list = list(best_map.values())

        self.out_dir.mkdir(exist_ok=True)
        self.dir_cache.add(str(self.out_dir))

        self.ui.start_progress()
        t1 = self.ui.add_task("Standard Configs", self.stats.total)
        t2 = self.ui.add_task("Optimized Configs", self.stats.best)

        await asyncio.gather(
            self._write_batch(final_list, "configs", t1, key, prefs),
            self._write_batch(best_list, "best_configs", t2, key, prefs)
        )
        self.ui.stop_progress()

        return str(self.out_dir)

    def _parse_batch(self, raw: List[Dict], lat: float, lon: float) -> List[Server]:
        results = []
        for d in raw:
            s = self._parse_one(d, lat, lon)
            if s:
                results.append(s)
        return results

    def _parse_one(self, data: Dict, lat: float, lon: float) -> Optional[Server]:
        try:
            locs = data.get('locations')
            if not locs: return None
            
            ver_str = "0.0.0"
            for s in data.get('specifications', []):
                if s.get('identifier') == 'version':
                    vals = s.get('values')
                    if vals: ver_str = vals[0].get('value', "0.0.0")
                    break
            
            if not self._check_version(ver_str):
                return None

            pk = ""
            for t in data.get('technologies', []):
                if t.get('identifier') == 'wireguard_udp':
                    for m in t.get('metadata', []):
                        if m.get('name') == 'public_key':
                            pk = m.get('value')
                            break
            if not pk: return None

            loc = locs[0]
            d = self._haversine(lat, lon, loc['latitude'], loc['longitude'])
            
            return Server(
                name=data['name'],
                hostname=data['hostname'],
                station=data['station'],
                load=int(data.get('load', 0)),
                country=loc['country']['name'],
                country_code=loc['country']['code'].lower(),
                city=loc['country']['city']['name'],
                latitude=loc['latitude'],
                longitude=loc['longitude'],
                public_key=pk,
                distance=d
            )
        except (KeyError, IndexError, ValueError, TypeError):
            return None

    def _check_version(self, v: str) -> bool:
        if len(v) < 3: return False
        try:
            parts = v.split('.')
            if len(parts) < 2: return False
            maj = int(parts[0])
            if maj > 2: return True
            return maj == 2 and int(parts[1]) >= 1
        except ValueError:
            return False

    def _haversine(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 6371
        dlat = radians(lat2 - lat1)
        dlon = radians(lon2 - lon1)
        a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)**2
        c = 2 * asin(sqrt(a))
        return R * c

    async def _write_batch(self, servers: List[Server], sub: str, task_id: TaskID, key: str, prefs: UserPreferences):
        sem = asyncio.Semaphore(200)
        path_counts: Dict[str, int] = {}
        
        async def _write(s: Server):
            async with sem:
                country = self._sanitize(s.country)
                city = self._sanitize(s.city)
                base = self._basename(s)
                rel = f"{sub}/{country}/{city}/{base}"
                
                count = path_counts.get(rel, 0)
                path_counts[rel] = count + 1
                
                fname = base
                if count > 0:
                    raw_base = base[:-5]
                    fname = f"{raw_base}_{count}.conf"

                full_dir = self.out_dir / sub / country / city
                self._ensure_dir(full_dir)
                
                ep = s.station if prefs.use_ip else s.hostname
                cfg = (
                    f"[Interface]\nPrivateKey = {key}\nAddress = 10.5.0.2/16\nDNS = {prefs.dns}\n\n"
                    f"[Peer]\nPublicKey = {s.public_key}\nAllowedIPs = 0.0.0.0/0, ::/0\n"
                    f"Endpoint = {ep}:51820\nPersistentKeepalive = {prefs.keepalive}"
                )
                
                async with aiofiles.open(full_dir / fname, 'w') as f:
                    await f.write(cfg)
                self.ui.update_progress(task_id)

        tasks = [_write(s) for s in servers]
        await asyncio.gather(*tasks)

    def _ensure_dir(self, path: Path):
        s_path = str(path)
        if s_path in self.dir_cache: return
        try:
            path.mkdir(parents=True, exist_ok=True)
            self.dir_cache.add(s_path)
        except OSError:
            pass

    def _sanitize(self, s: str) -> str:
        return s.lower().replace(' ', '_').translate(self.path_sanitizer)

    def _basename(self, s: Server) -> str:
        name = s.name
        num = ""
        for i in range(len(name)-1, -1, -1):
            if name[i].isdigit():
                start = i
                while start >= 0 and name[start].isdigit():
                    start -= 1
                num = name[start+1:i+1]
                break
        
        if not num:
            fallback = f"wg{s.station.replace('.', '')}"
            return f"{fallback[:15]}.conf"
        
        base = f"{s.country_code}{num}"
        return f"{base[:15]}.conf"