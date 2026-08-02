import base64
import binascii
from ipaddress import ip_address

ENDPOINT_PORT = 51820


class WireGuardValueError(ValueError):
    pass


def validate_key(value: str) -> None:
    try:
        decoded = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise WireGuardValueError("key must be a base64-encoded 32-byte value") from error
    if len(decoded) != 32:
        raise WireGuardValueError("key must be a base64-encoded 32-byte value")


def validate_endpoint(value: str) -> None:
    endpoint = value.strip()
    if not endpoint:
        raise WireGuardValueError("endpoint is empty")
    if any(character.isspace() for character in endpoint):
        raise WireGuardValueError("endpoint contains whitespace")
    try:
        ip_address(endpoint)
        return
    except ValueError:
        pass
    if len(endpoint) > 253 or endpoint.endswith("."):
        raise WireGuardValueError("endpoint hostname is invalid")
    labels = endpoint.split(".")
    if len(labels) < 2:
        raise WireGuardValueError("endpoint hostname is invalid")
    for label in labels:
        if not label or len(label) > 63 or label.startswith("-") or label.endswith("-"):
            raise WireGuardValueError("endpoint hostname is invalid")
        if not all(
            character.isascii() and (character.isalnum() or character == "-") for character in label
        ):
            raise WireGuardValueError("endpoint hostname is invalid")


def build_config(
    private_key: str,
    public_key: str,
    endpoint: str,
    dns: str,
    keepalive: int,
) -> bytes:
    try:
        validate_key(private_key)
    except WireGuardValueError as error:
        raise WireGuardValueError(f"invalid private key: {error}") from error
    try:
        validate_key(public_key)
    except WireGuardValueError as error:
        raise WireGuardValueError(f"invalid public key: {error}") from error

    normalized_endpoint = endpoint.strip()
    try:
        validate_endpoint(normalized_endpoint)
    except WireGuardValueError as error:
        raise WireGuardValueError(f"invalid endpoint: {error}") from error

    try:
        dns_address = ip_address(dns.strip())
    except ValueError as error:
        raise WireGuardValueError("invalid DNS address") from error
    if keepalive < 0 or keepalive > 65535:
        raise WireGuardValueError("keepalive must be between 0 and 65535 seconds")

    host = normalized_endpoint
    try:
        endpoint_address = ip_address(normalized_endpoint)
    except ValueError:
        endpoint_address = None
    if endpoint_address is not None:
        host = endpoint_address.compressed
        if endpoint_address.version == 6:
            host = f"[{host}]"

    content = (
        f"[Interface]\nPrivateKey = {private_key}\n"
        f"Address = 10.5.0.2/16\nDNS = {dns_address.compressed}\n\n"
        f"[Peer]\nPublicKey = {public_key}\n"
        f"AllowedIPs = 0.0.0.0/0, ::/0\n"
        f"Endpoint = {host}:{ENDPOINT_PORT}\n"
        f"PersistentKeepalive = {keepalive}\n"
    )
    return content.encode()
