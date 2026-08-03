from dataclasses import dataclass
from ipaddress import ip_address

MAX_KEEPALIVE = 65535


@dataclass(slots=True, frozen=True)
class Coordinates:
    latitude: float
    longitude: float



@dataclass(slots=True, frozen=True)
class Server:
    name: str
    hostname: str
    station: str
    load: int
    country: str
    city: str
    public_key: str
    distance: float
    combo: str
    latency: float | None = None  # measured RTT in ms; None if not probed / unreachable



@dataclass(slots=True, frozen=True)
class UserPreferences:
    dns: str = "103.86.96.100"
    use_ip: bool = False
    keepalive: int = 25
    groups: tuple[str, ...] = ()
    exclude_dedicated: bool = False
    measure_latency: bool = False


    def validate(self) -> None:
        try:
            ip_address(self.dns.strip())
        except ValueError as error:
            raise ValueError("DNS must be a valid IPv4 or IPv6 address") from error
        if self.keepalive < 0 or self.keepalive > MAX_KEEPALIVE:
            raise ValueError(f"keepalive must be between 0 and {MAX_KEEPALIVE} seconds")


@dataclass(slots=True)
class GenerationStats:
    total: int = 0
    best: int = 0
