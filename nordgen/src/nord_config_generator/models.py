from dataclasses import dataclass, field

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

@dataclass(slots=True, frozen=True)
class UserPreferences:
    dns: str = "103.86.96.100"
    use_ip: bool = False
    keepalive: int = 25

@dataclass(slots=True)
class GenerationStats:
    total: int = 0
    best: int = 0
    rejected: int = 0
