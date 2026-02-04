class Server:
    __slots__ = (
        'name', 'hostname', 'station', 'load', 'country', 
        'country_code', 'city', 'latitude', 'longitude', 
        'public_key', 'distance'
    )

    def __init__(
        self, name: str, hostname: str, station: str, load: int,
        country: str, country_code: str, city: str,
        latitude: float, longitude: float, public_key: str, distance: float
    ):
        self.name = name
        self.hostname = hostname
        self.station = station
        self.load = load
        self.country = country
        self.country_code = country_code
        self.city = city
        self.latitude = latitude
        self.longitude = longitude
        self.public_key = public_key
        self.distance = distance

class UserPreferences:
    __slots__ = ('dns', 'use_ip', 'keepalive')

    def __init__(self, dns: str = "103.86.96.100", use_ip: bool = False, keepalive: int = 25):
        self.dns = dns
        self.use_ip = use_ip
        self.keepalive = keepalive

class Stats:
    __slots__ = ('total', 'best', 'rejected')

    def __init__(self):
        self.total = 0
        self.best = 0
        self.rejected = 0