import aiohttp
import json
import base64
from typing import Optional, List, Dict, Tuple

class NordClient:
    BASE_URL = "https://api.nordvpn.com/v1"
    GEO_URL = "https://api.nordvpn.com/v1/helpers/ips/insights"

    def __init__(self):
        self._session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        timeout = aiohttp.ClientTimeout(total=20)
        connector = aiohttp.TCPConnector(limit=10, ttl_dns_cache=300)
        self._session = aiohttp.ClientSession(timeout=timeout, connector=connector)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session:
            await self._session.close()

    async def get_key(self, token: str) -> Optional[str]:
        if not self._session: return None
        try:
            auth = base64.b64encode(f'token:{token}'.encode()).decode()
            headers = {'Authorization': f'Basic {auth}'}
            async with self._session.get(f"{self.BASE_URL}/users/services/credentials", headers=headers) as resp:
                if resp.status != 200: return None
                data = await resp.json()
                return data.get('nordlynx_private_key')
        except (aiohttp.ClientError, json.JSONDecodeError):
            return None

    async def get_servers(self) -> List[Dict]:
        if not self._session: return []
        try:
            params = {'limit': '16384', 'filters[servers_technologies][identifier]': 'wireguard_udp'}
            async with self._session.get(f"{self.BASE_URL}/servers", params=params) as resp:
                if resp.status != 200: return []
                return await resp.json()
        except (aiohttp.ClientError, json.JSONDecodeError):
            return []

    async def get_geo(self) -> Tuple[float, float]:
        if not self._session: return 0.0, 0.0
        try:
            async with self._session.get(self.GEO_URL) as resp:
                if resp.status != 200: return 0.0, 0.0
                data = await resp.json()
                return float(data.get('latitude', 0)), float(data.get('longitude', 0))
        except (aiohttp.ClientError, json.JSONDecodeError, ValueError):
            return 0.0, 0.0