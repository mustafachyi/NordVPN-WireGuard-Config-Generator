import asyncio
import os
import re
from dataclasses import dataclass
from datetime import datetime
from math import asin, cos, radians, sin, sqrt
from pathlib import Path
from typing import Optional

from rich.progress import Progress, TaskID

from .client import NordClient
from .models import GenerationStats, Server, UserPreferences
from .ui import ConsoleManager

_TRAILING_NUMBER_PATTERN = re.compile(r"(\d+)\D*$")
_PATH_SANITIZER = str.maketrans("", "", '<>:"/\\|?*\0')
_EARTH_RADIUS_KM = 6371.0
_FILENAME_MAX_LENGTH = 15
_MINIMUM_SUPPORTED_MAJOR = 2
_MINIMUM_SUPPORTED_MINOR = 1


@dataclass(slots=True, frozen=True)
class _ConfigWriteJob:
    absolute_path: Path
    content: str


class Generator:
    def __init__(self, client: NordClient, ui: ConsoleManager) -> None:
        self.client = client
        self.ui = ui
        self.stats = GenerationStats()
        self.output_directory: Optional[Path] = None

    async def process(self, private_key: str, preferences: UserPreferences) -> Optional[str]:
        self.output_directory = Path(
            f"nordvpn_configs_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        )

        with self.ui.status("Fetching data..."):
            (latitude, longitude), raw_servers = await asyncio.gather(
                self.client.get_geo(),
                self.client.get_servers(),
            )

        if not raw_servers:
            self.ui.fail("Failed to fetch server data")
            return None
        self.ui.success("Data fetched")

        with self.ui.status("Processing dataset..."):
            parsed_servers = self._parse_server_batch(raw_servers, latitude, longitude)
            unique_servers = list({server.name: server for server in parsed_servers}.values())
            unique_servers.sort(key=lambda server: (server.load, server.distance))

            self.stats.rejected = len(raw_servers) - len(unique_servers)
            self.stats.total = len(unique_servers)

            optimized_servers: dict[tuple[str, str], Server] = {}
            for server in unique_servers:
                optimized_servers.setdefault((server.country, server.city), server)
            self.stats.best = len(optimized_servers)

            standard_jobs = self._build_jobs(unique_servers, "configs", private_key, preferences)
            optimized_jobs = self._build_jobs(
                list(optimized_servers.values()), "best_configs", private_key, preferences
            )

        await asyncio.to_thread(self._materialize_directories, standard_jobs + optimized_jobs)

        with self.ui.progress() as progress:
            standard_task = progress.add_task("Standard Configs", total=len(standard_jobs))
            optimized_task = progress.add_task("Optimized Configs", total=len(optimized_jobs))
            await asyncio.gather(
                asyncio.to_thread(self._write_jobs, standard_jobs, progress, standard_task),
                asyncio.to_thread(self._write_jobs, optimized_jobs, progress, optimized_task),
            )

        return str(self.output_directory)

    def _parse_server_batch(
        self, raw_servers: list[dict], latitude: float, longitude: float
    ) -> list[Server]:
        parsed: list[Server] = []
        for raw_server in raw_servers:
            server = self._parse_server_record(raw_server, latitude, longitude)
            if server is not None:
                parsed.append(server)
        return parsed

    def _parse_server_record(
        self, data: dict, observer_latitude: float, observer_longitude: float
    ) -> Optional[Server]:
        try:
            locations = data.get("locations")
            if not locations:
                return None

            version_string = "0.0.0"
            for specification in data.get("specifications", []):
                if specification.get("identifier") == "version":
                    values = specification.get("values")
                    if values:
                        version_string = values[0].get("value", "0.0.0")
                    break
            if not self._is_version_supported(version_string):
                return None

            public_key = ""
            for technology in data.get("technologies", []):
                if technology.get("identifier") == "wireguard_udp":
                    for metadata_entry in technology.get("metadata", []):
                        if metadata_entry.get("name") == "public_key":
                            public_key = metadata_entry.get("value", "")
                            break
                    break
            if not public_key:
                return None

            primary_location = locations[0]
            distance = self._haversine_kilometers(
                observer_latitude,
                observer_longitude,
                primary_location["latitude"],
                primary_location["longitude"],
            )

            return Server(
                name=data["name"],
                hostname=data["hostname"],
                station=data["station"],
                load=int(data.get("load", 0)),
                country=primary_location["country"]["name"],
                country_code=primary_location["country"]["code"].lower(),
                city=primary_location["country"]["city"]["name"],
                latitude=primary_location["latitude"],
                longitude=primary_location["longitude"],
                public_key=public_key,
                distance=distance,
            )
        except (KeyError, IndexError, ValueError, TypeError):
            return None

    @staticmethod
    def _is_version_supported(version_string: str) -> bool:
        try:
            major_part, minor_part, *_ = version_string.split(".")
            major = int(major_part)
            if major > _MINIMUM_SUPPORTED_MAJOR:
                return True
            return major == _MINIMUM_SUPPORTED_MAJOR and int(minor_part) >= _MINIMUM_SUPPORTED_MINOR
        except (ValueError, IndexError):
            return False

    @staticmethod
    def _haversine_kilometers(
        latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float
    ) -> float:
        delta_latitude = radians(latitude_b - latitude_a)
        delta_longitude = radians(longitude_b - longitude_a)
        intermediate = (
            sin(delta_latitude / 2) ** 2
            + cos(radians(latitude_a)) * cos(radians(latitude_b)) * sin(delta_longitude / 2) ** 2
        )
        return _EARTH_RADIUS_KM * 2 * asin(sqrt(intermediate))

    def _build_jobs(
        self,
        servers: list[Server],
        subdirectory: str,
        private_key: str,
        preferences: UserPreferences,
    ) -> list[_ConfigWriteJob]:
        assert self.output_directory is not None
        jobs: list[_ConfigWriteJob] = []
        filename_counts: dict[Path, int] = {}

        for server in servers:
            country_segment = self._sanitize_path_segment(server.country)
            city_segment = self._sanitize_path_segment(server.city)
            filename_root = self._build_config_filename_root(server)
            directory = self.output_directory / subdirectory / country_segment / city_segment

            candidate_path = directory / f"{filename_root}.conf"
            count = filename_counts.get(candidate_path, 0)
            filename_counts[candidate_path] = count + 1
            final_path = (
                candidate_path
                if count == 0
                else directory / f"{filename_root}_{count}.conf"
            )

            endpoint = server.station if preferences.use_ip else server.hostname
            content = (
                f"[Interface]\nPrivateKey = {private_key}\nAddress = 10.5.0.2/16\n"
                f"DNS = {preferences.dns}\n\n"
                f"[Peer]\nPublicKey = {server.public_key}\nAllowedIPs = 0.0.0.0/0, ::/0\n"
                f"Endpoint = {endpoint}:51820\nPersistentKeepalive = {preferences.keepalive}"
            )
            jobs.append(_ConfigWriteJob(absolute_path=final_path, content=content))
        return jobs

    @staticmethod
    def _materialize_directories(jobs: list[_ConfigWriteJob]) -> None:
        unique_directories = {job.absolute_path.parent for job in jobs}
        for directory in unique_directories:
            directory.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _write_jobs(jobs: list[_ConfigWriteJob], progress: Progress, task_id: TaskID) -> None:
        for job in jobs:
            with open(job.absolute_path, "w", encoding="utf-8") as file_handle:
                file_handle.write(job.content)
            progress.advance(task_id)

    @staticmethod
    def _sanitize_path_segment(segment: str) -> str:
        return segment.lower().replace(" ", "_").translate(_PATH_SANITIZER)

    @staticmethod
    def _build_config_filename_root(server: Server) -> str:
        match = _TRAILING_NUMBER_PATTERN.search(server.name)
        if match is None:
            fallback = f"wg{server.station.replace('.', '')}"
            return fallback[:_FILENAME_MAX_LENGTH]
        return f"{server.country_code}{match.group(1)}"[:_FILENAME_MAX_LENGTH]
