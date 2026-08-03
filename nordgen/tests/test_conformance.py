import json
from pathlib import Path

from nord_config_generator.generator import _server_sort_key
from nord_config_generator.models import Coordinates
from nord_config_generator.server_parser import parse_servers

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "nordgen-go" / "testdata" / "server_conformance.json"
)


def test_server_catalogue_conformance() -> None:
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    observer_value = fixture["observer"]
    observer = (
        None
        if observer_value is None
        else Coordinates(
            latitude=float(observer_value["latitude"]),
            longitude=float(observer_value["longitude"]),
        )
    )

    parsed = parse_servers(
        fixture["records"],
        observer,
        tuple(fixture["required_groups"]),
        bool(fixture["exclude_dedicated"]),
        bool(fixture["use_ip"]),
    )
    parsed.sort(key=_server_sort_key)

    actual: list[dict[str, object]] = []
    seen_hostnames: set[str] = set()
    for server in parsed:
        if server.hostname in seen_hostnames:
            continue

        seen_hostnames.add(server.hostname)
        actual.append(
            {
                "name": server.name,
                "hostname": server.hostname,
                "station": server.station,
                "load": server.load,
                "country": server.country,
                "city": server.city,
                "public_key": server.public_key,
                "combo": server.combo,
            }
        )

    assert actual == fixture["expected"]
