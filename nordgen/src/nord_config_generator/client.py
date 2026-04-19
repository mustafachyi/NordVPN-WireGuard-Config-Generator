import base64
import json
from typing import Optional

import aiohttp


class NordClient:
    BASE_URL = "https://api.nordvpn.com/v1"
    GEO_URL = "https://api.nordvpn.com/v1/helpers/ips/insights"
    SERVER_FETCH_LIMIT = "16384"
    WIREGUARD_TECHNOLOGY = "wireguard_udp"

    def __init__(self) -> None:
        self._session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self) -> "NordClient":
        timeout = aiohttp.ClientTimeout(connect=5, sock_read=15, total=25)
        connector = aiohttp.TCPConnector(
            limit=10,
            ttl_dns_cache=300,
            enable_cleanup_closed=True,
        )
        self._session = aiohttp.ClientSession(timeout=timeout, connector=connector)
        return self

    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        if self._session is not None:
            await self._session.close()

    async def get_key(self, token: str) -> Optional[str]:
        if self._session is None:
            return None
        encoded_credentials = base64.b64encode(f"token:{token}".encode()).decode()
        headers = {"Authorization": f"Basic {encoded_credentials}"}
        try:
            async with self._session.get(
                f"{self.BASE_URL}/users/services/credentials", headers=headers
            ) as response:
                if response.status != 200:
                    return None
                payload = await response.json()
                return payload.get("nordlynx_private_key")
        except (aiohttp.ClientError, json.JSONDecodeError):
            return None

    async def get_servers(self) -> list[dict]:
        if self._session is None:
            return []
        params = {
            "limit": self.SERVER_FETCH_LIMIT,
            "filters[servers_technologies][identifier]": self.WIREGUARD_TECHNOLOGY,
        }
        try:
            async with self._session.get(f"{self.BASE_URL}/servers", params=params) as response:
                if response.status != 200:
                    return []
                return await response.json()
        except (aiohttp.ClientError, json.JSONDecodeError):
            return []

    async def get_geo(self) -> tuple[float, float]:
        if self._session is None:
            return 0.0, 0.0
        try:
            async with self._session.get(self.GEO_URL) as response:
                if response.status != 200:
                    return 0.0, 0.0
                payload = await response.json()
                return float(payload.get("latitude", 0)), float(payload.get("longitude", 0))
        except (aiohttp.ClientError, json.JSONDecodeError, ValueError):
            return 0.0, 0.0
