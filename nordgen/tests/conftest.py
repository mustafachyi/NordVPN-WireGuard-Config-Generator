import base64
from collections.abc import Sequence

import pytest

from nord_config_generator.constants import GROUP_STANDARD_ID


def valid_key(fill: int) -> str:
    return base64.b64encode(bytes([fill]) * 32).decode()


def raw_server(
    hostname: str = "us1.example.com",
    load: int = 10,
    latitude: float = 1,
    longitude: float = 1,
    groups: Sequence[str] = (GROUP_STANDARD_ID,),
) -> dict[str, object]:
    return {
        "hostname": hostname,
        "station": "192.0.2.1",
        "load": load,
        "locations": [
            {
                "latitude": latitude,
                "longitude": longitude,
                "country": {"name": "Country", "city": {"name": "City"}},
            }
        ],
        "groups": [{"identifier": group} for group in groups],
        "technologies": [{"metadata": [{"name": "public_key", "value": valid_key(2)}]}],
    }


@pytest.fixture
def key_factory():
    return valid_key


@pytest.fixture
def server_factory():
    return raw_server
