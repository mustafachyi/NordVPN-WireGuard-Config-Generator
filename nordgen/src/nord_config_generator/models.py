from dataclasses import dataclass


@dataclass(slots=True, frozen=True)
class Server:
    name: str
    hostname: str
    station: str
    load: int
    country: str
    country_code: str
    city: str
    latitude: float
    longitude: float
    public_key: str
    distance: float
    combo: str
    latency: float | None = None  # measured RTT in ms; None if not probed / unreachable


@dataclass(slots=True, frozen=True)
class UserPreferences:
    dns: str = "103.86.96.100"
    use_ip: bool = False
    keepalive: int = 25
    groups: list[str] | None = None
    exclude_dedicated: bool = False
    measure_latency: bool = False


@dataclass(slots=True)
class GenerationStats:
    total: int = 0
    best: int = 0
