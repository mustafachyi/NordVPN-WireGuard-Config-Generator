import base64

import pytest

from nord_config_generator.wireguard import (
    WireGuardValueError,
    build_config,
    validate_endpoint,
    validate_key,
)


def key(fill: int) -> str:
    return base64.b64encode(bytes([fill]) * 32).decode()


def test_validate_key() -> None:
    validate_key(key(1))
    for value in ["", "not-base64", base64.b64encode(bytes(31)).decode()]:
        with pytest.raises(WireGuardValueError):
            validate_key(value)


@pytest.mark.parametrize(
    "value",
    ["us123.nordvpn.com", "1.2.3.4", "2001:db8::1", "a-b.example.com"],
)
def test_validate_endpoint_accepts_valid_values(value: str) -> None:
    validate_endpoint(value)


@pytest.mark.parametrize(
    "value",
    [
        "",
        "localhost",
        "bad host.example",
        "-bad.example",
        "bad-.example",
        "bad..example",
        "bad.example.",
        "bad_example.com",
        "example\n.com",
        "é.example.com",
    ],
)
def test_validate_endpoint_rejects_invalid_values(value: str) -> None:
    with pytest.raises(WireGuardValueError):
        validate_endpoint(value)


def test_build_config_normalizes_addresses_and_terminates_with_newline() -> None:
    content = build_config(key(1), key(2), " 2001:0db8::1 ", " 1.1.1.1 ", 25).decode()
    assert f"PrivateKey = {key(1)}" in content
    assert f"PublicKey = {key(2)}" in content
    assert "DNS = 1.1.1.1" in content
    assert "Endpoint = [2001:db8::1]:51820" in content
    assert content.endswith("PersistentKeepalive = 25\n")


@pytest.mark.parametrize(
    "private_key, public_key, endpoint, dns, keepalive",
    [
        ("bad", key(2), "us1.example.com", "1.1.1.1", 25),
        (key(1), "bad", "us1.example.com", "1.1.1.1", 25),
        (key(1), key(2), "bad endpoint", "1.1.1.1", 25),
        (key(1), key(2), "us1.example.com", "bad", 25),
        (key(1), key(2), "us1.example.com", "1.1.1.1", 65536),
    ],
)
def test_build_config_rejects_invalid_values(
    private_key: str,
    public_key: str,
    endpoint: str,
    dns: str,
    keepalive: int,
) -> None:
    with pytest.raises(WireGuardValueError):
        build_config(private_key, public_key, endpoint, dns, keepalive)
