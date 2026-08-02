import base64
import json
from dataclasses import dataclass
from math import isfinite
from types import TracebackType
from typing import Self, cast

import aiohttp

from .constants import CREDS_URL, GEO_URL, SERVERS_URL
from .models import Coordinates
from .wireguard import WireGuardValueError, validate_key

CREDENTIALS_RESPONSE_LIMIT = 64 * 1024
GEO_RESPONSE_LIMIT = 64 * 1024
SERVERS_RESPONSE_LIMIT = 64 * 1024 * 1024
USER_AGENT = "nordgen-python/2"


class NordClientError(RuntimeError):
    pass


class UnauthorizedError(NordClientError):
    pass


@dataclass(slots=True, frozen=True)
class Endpoints:
    servers: str = SERVERS_URL
    geo: str = GEO_URL
    credentials: str = CREDS_URL


class NordClient:
    def __init__(
        self,
        *,
        endpoints: Endpoints | None = None,
        session: aiohttp.ClientSession | None = None,
    ) -> None:
        self._endpoints = endpoints or Endpoints()
        self._session = session
        self._owns_session = session is None

    async def __aenter__(self) -> Self:
        if self._session is None:
            timeout = aiohttp.ClientTimeout(
                total=25,
                connect=5,
                sock_connect=5,
                sock_read=15,
            )
            connector = aiohttp.TCPConnector(
                limit=10,
                limit_per_host=10,
                ttl_dns_cache=300,
            )
            self._session = aiohttp.ClientSession(
                timeout=timeout,
                connector=connector,
            )
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if self._owns_session and self._session is not None:
            await self._session.close()
            self._session = None

    async def get_key(self, token: str) -> str:
        authorization = base64.b64encode(f"token:{token}".encode()).decode()

        try:
            payload = await self._get_json(
                self._endpoints.credentials,
                {"Authorization": f"Basic {authorization}"},
                CREDENTIALS_RESPONSE_LIMIT,
            )
        except UnauthorizedError:
            raise
        except NordClientError as error:
            raise NordClientError(f"get credentials: {error}") from error

        if not isinstance(payload, dict):
            raise NordClientError("credentials response was not a JSON object")

        value = payload.get("nordlynx_private_key")
        if not isinstance(value, str):
            raise NordClientError("credentials response did not contain a private key")

        private_key = value.strip()

        try:
            validate_key(private_key)
        except WireGuardValueError as error:
            raise NordClientError(
                f"credentials response contained an invalid private key: {error}"
            ) from error

        return private_key

    async def get_geo(self) -> Coordinates:
        try:
            payload = await self._get_json(
                self._endpoints.geo,
                None,
                GEO_RESPONSE_LIMIT,
            )
        except NordClientError as error:
            raise NordClientError(f"get geolocation: {error}") from error

        if not isinstance(payload, dict):
            raise NordClientError("geolocation response was not a JSON object")

        latitude = payload.get("latitude")
        longitude = payload.get("longitude")

        if (
            isinstance(latitude, bool)
            or isinstance(longitude, bool)
            or not isinstance(latitude, int | float)
            or not isinstance(longitude, int | float)
        ):
            raise NordClientError("geolocation response contained invalid coordinates")

        normalized_latitude = float(latitude)
        normalized_longitude = float(longitude)

        if (
            not isfinite(normalized_latitude)
            or not isfinite(normalized_longitude)
            or normalized_latitude < -90
            or normalized_latitude > 90
            or normalized_longitude < -180
            or normalized_longitude > 180
        ):
            raise NordClientError("geolocation response contained invalid coordinates")

        return Coordinates(normalized_latitude, normalized_longitude)

    async def get_servers(self) -> list[object]:
        try:
            payload = await self._get_json(
                self._endpoints.servers,
                None,
                SERVERS_RESPONSE_LIMIT,
            )
        except NordClientError as error:
            raise NordClientError(f"get servers: {error}") from error

        if not isinstance(payload, list):
            raise NordClientError("server response was not a JSON array")

        if not payload:
            raise NordClientError("server response was empty")

        return payload

    async def _get_json(
        self,
        target: str,
        headers: dict[str, str] | None,
        limit: int,
    ) -> object:
        if self._session is None:
            raise RuntimeError("NordClient must be used as an async context manager")

        request_headers = {
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }

        if headers:
            request_headers.update(headers)

        try:
            async with self._session.get(
                target,
                headers=request_headers,
                allow_redirects=False,
            ) as response:
                if response.status in {401, 403}:
                    raise UnauthorizedError(f"HTTP {response.status}")

                if response.status != 200:
                    raise NordClientError(
                        f"unexpected HTTP status {response.status}"
                    )

                if (
                    response.content_length is not None
                    and response.content_length > limit
                ):
                    raise NordClientError(f"response exceeded {limit} bytes")

                body = bytearray()

                async for chunk in response.content.iter_chunked(64 * 1024):
                    if len(body) + len(chunk) > limit:
                        raise NordClientError(f"response exceeded {limit} bytes")

                    body.extend(chunk)

        except UnauthorizedError:
            raise
        except NordClientError:
            raise
        except (TimeoutError, aiohttp.ClientError) as error:
            raise NordClientError(f"perform request: {error}") from error

        if not body:
            raise NordClientError("response body was empty")

        try:
            return cast(object, json.loads(body))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise NordClientError(f"decode response: {error}") from error