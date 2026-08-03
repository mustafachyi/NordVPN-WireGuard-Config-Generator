import math

import pytest

from nord_config_generator.constants import (
    GROUP_DEDICATED_ID,
    GROUP_P2P_ID,
    GROUP_STANDARD_ID,
)
from nord_config_generator.models import Coordinates
from nord_config_generator.server_parser import (
    calculate_distance,
    parse_servers,
    valid_coordinates,
)


def test_parse_servers_filters_groups_and_normalizes(server_factory, key_factory) -> None:
    first = server_factory(
        hostname="  US1.EXAMPLE.COM  ",
        groups=(GROUP_STANDARD_ID, GROUP_P2P_ID, GROUP_STANDARD_ID),
    )
    first["technologies"][0]["metadata"][0]["value"] = f"  {key_factory(2)}  "
    parsed = parse_servers(
        [first, server_factory(hostname="us2.example.com", groups=(GROUP_STANDARD_ID,))],
        Coordinates(0, 0),
        (GROUP_STANDARD_ID, GROUP_P2P_ID),
        False,
        False,
    )
    assert len(parsed) == 1
    assert parsed[0].hostname == "us1.example.com"
    assert parsed[0].name == "us1"
    assert parsed[0].combo == "p2p_standard"
    assert parsed[0].distance > 0


def test_parse_servers_excludes_dedicated_and_uses_zero_distance(server_factory) -> None:
    servers = [
        server_factory(groups=(GROUP_STANDARD_ID, GROUP_DEDICATED_ID)),
        server_factory(hostname="us2.example.com", groups=(GROUP_STANDARD_ID,)),
    ]
    parsed = parse_servers(servers, None, (), True, False)
    assert [server.hostname for server in parsed] == ["us2.example.com"]
    assert parsed[0].distance == 0


def test_parse_servers_requires_valid_ip_when_requested(server_factory) -> None:
    server = server_factory()
    server["station"] = "not-an-ip"
    assert parse_servers([server], None, (), False, True) == []
    server["station"] = "2001:0db8::1"
    parsed = parse_servers([server], None, (), False, True)
    assert parsed[0].station == "2001:db8::1"


def test_parse_servers_rejects_malformed_records(server_factory) -> None:
    cases: list[object] = [None, [], {"load": 10}]
    mutations = [
        lambda server: server.update(load=-1),
        lambda server: server.update(load=101),
        lambda server: server.update(load=True),
        lambda server: server.update(hostname="invalid"),
        lambda server: server.update(groups=[]),
        lambda server: server.update(locations=[]),
        lambda server: server["locations"][0].update(latitude=math.nan),
        lambda server: server["locations"][0]["country"].update(name=""),
        lambda server: server["technologies"][0]["metadata"][0].update(value="bad"),
        lambda server: server.update(technologies="invalid"),
    ]
    for mutation in mutations:
        server = server_factory()
        mutation(server)
        cases.append(server)
    assert parse_servers(cases, None, (), False, False) == []


def test_parse_servers_ignores_unknown_group_and_invalid_nested_values(server_factory) -> None:
    server = server_factory()
    server["groups"].append({"identifier": "unknown"})
    server["groups"].append("invalid")
    server["technologies"].insert(0, {"metadata": [None, {"name": "other"}]})
    parsed = parse_servers([server], None, (), False, False)
    assert len(parsed) == 1


def test_distance_and_coordinate_validation() -> None:
    assert calculate_distance(0, 0, 1, 0, 1) == pytest.approx(111.195, abs=0.1)
    assert valid_coordinates(90, 180)
    for latitude, longitude in [(math.nan, 0), (math.inf, 0), (91, 0), (0, 181)]:
        assert not valid_coordinates(latitude, longitude)
