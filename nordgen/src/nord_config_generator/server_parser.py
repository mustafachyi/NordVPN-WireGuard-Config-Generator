from collections.abc import Iterable, Mapping, Sequence
from ipaddress import ip_address
from math import asin, cos, isfinite, pi, sin, sqrt

from .constants import (
    GROUP_DEDICATED_ID,
    GROUP_ID_TO_ALIAS,
    TYPE_GROUPS,
)
from .models import Coordinates, Server
from .wireguard import (
    WireGuardValueError,
    validate_endpoint,
    validate_key,
)

EARTH_RADIUS_KM = 6371.0


def valid_coordinates(
    latitude: float,
    longitude: float,
) -> bool:
    return (
        isfinite(latitude)
        and isfinite(longitude)
        and -90 <= latitude <= 90
        and -180 <= longitude <= 180
    )


def calculate_distance(
    observer_latitude_radians: float,
    observer_longitude_radians: float,
    observer_latitude_cosine: float,
    latitude: float,
    longitude: float,
) -> float:
    latitude_radians = latitude * pi / 180
    latitude_delta = latitude_radians - observer_latitude_radians
    longitude_delta = longitude * pi / 180 - observer_longitude_radians
    latitude_sine = sin(latitude_delta / 2)
    longitude_sine = sin(longitude_delta / 2)
    value = (
        latitude_sine * latitude_sine
        + observer_latitude_cosine * cos(latitude_radians) * longitude_sine * longitude_sine
    )
    bounded = max(
        0.0,
        min(1.0, value),
    )
    return EARTH_RADIUS_KM * 2 * asin(sqrt(bounded))


def parse_servers(
    raw_servers: Iterable[object],
    observer: Coordinates | None,
    required_groups: tuple[str, ...],
    exclude_dedicated: bool,
    use_ip: bool,
) -> list[Server]:
    required = set(required_groups)

    observer_latitude_radians = 0.0
    observer_longitude_radians = 0.0
    observer_latitude_cosine = 0.0

    if observer is not None:
        observer_latitude_radians = observer.latitude * pi / 180
        observer_longitude_radians = observer.longitude * pi / 180
        observer_latitude_cosine = cos(observer_latitude_radians)

    parsed: list[Server] = []

    for raw_value in raw_servers:
        raw = _mapping(raw_value)
        if raw is None:
            continue

        load = raw.get("load")
        if isinstance(load, bool) or not isinstance(load, int) or load < 0 or load > 100:
            continue

        locations = _sequence(raw.get("locations"))
        if not locations:
            continue

        hostname_value = raw.get("hostname")
        if not isinstance(
            hostname_value,
            str,
        ):
            continue

        hostname = hostname_value.strip().lower()
        try:
            validate_endpoint(hostname)
        except WireGuardValueError:
            continue

        station_value = raw.get("station")
        if not isinstance(
            station_value,
            str,
        ):
            station_value = ""

        station = station_value.strip()
        if use_ip:
            try:
                station = ip_address(station).compressed
            except ValueError:
                continue

        group_values = _sequence(raw.get("groups")) or ()
        group_ids: set[str] = set()
        has_dedicated = False

        for group_value in group_values:
            group = _mapping(group_value)
            if group is None:
                continue

            identifier = group.get("identifier")
            if (
                not isinstance(
                    identifier,
                    str,
                )
                or identifier not in TYPE_GROUPS
            ):
                continue

            group_ids.add(identifier)

            if identifier == GROUP_DEDICATED_ID:
                has_dedicated = True

        if (
            not group_ids
            or (exclude_dedicated and has_dedicated)
            or not required.issubset(group_ids)
        ):
            continue

        public_key = _find_public_key(_sequence(raw.get("technologies")) or ())
        try:
            validate_key(public_key)
        except WireGuardValueError:
            continue

        location = _mapping(locations[0])
        if location is None:
            continue

        latitude = _number(location.get("latitude"))
        longitude = _number(location.get("longitude"))
        if (
            latitude is None
            or longitude is None
            or not valid_coordinates(
                latitude,
                longitude,
            )
        ):
            continue

        country_value = _mapping(location.get("country"))
        if country_value is None:
            continue

        country_name = country_value.get("name")
        city_value = _mapping(country_value.get("city"))
        city_name = None if city_value is None else city_value.get("name")

        if not isinstance(
            country_name,
            str,
        ) or not isinstance(
            city_name,
            str,
        ):
            continue

        country = country_name.strip()
        city = city_name.strip()
        if not country or not city:
            continue

        name = hostname.split(
            ".",
            1,
        )[0]
        if not name:
            continue

        distance = 0.0
        if observer is not None:
            distance = calculate_distance(
                observer_latitude_radians,
                observer_longitude_radians,
                observer_latitude_cosine,
                latitude,
                longitude,
            )

        combo = "_".join(GROUP_ID_TO_ALIAS[identifier] for identifier in sorted(group_ids))

        parsed.append(
            Server(
                name=name,
                hostname=hostname,
                station=station,
                load=load,
                country=country,
                city=city,
                public_key=public_key,
                distance=distance,
                combo=combo,
            )
        )

    return parsed


def _mapping(
    value: object,
) -> Mapping[str, object] | None:
    if not isinstance(value, Mapping):
        return None

    if not all(isinstance(key, str) for key in value):
        return None

    return value


def _sequence(
    value: object,
) -> Sequence[object] | None:
    if isinstance(
        value,
        str | bytes | bytearray,
    ) or not isinstance(
        value,
        Sequence,
    ):
        return None

    return value


def _number(
    value: object,
) -> float | None:
    if isinstance(value, bool) or not isinstance(
        value,
        int | float,
    ):
        return None

    return float(value)


def _find_public_key(
    technologies: Sequence[object],
) -> str:
    for technology_value in technologies:
        technology = _mapping(technology_value)
        if technology is None:
            continue

        metadata_values = _sequence(technology.get("metadata")) or ()

        for metadata_value in metadata_values:
            metadata = _mapping(metadata_value)
            if metadata is None or metadata.get("name") != "public_key":
                continue

            value = metadata.get("value")
            if isinstance(value, str) and value.strip():
                return value.strip()

    return ""
