import asyncio
import os
import queue
import shutil
import tempfile
import threading
import time
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Protocol

from .constants import GROUP_DEDICATED_ID, TYPE_GROUPS
from .models import Coordinates, GenerationStats, Server, UserPreferences
from .permissions import secure_output_root
from .server_parser import parse_servers, valid_coordinates
from .ui import ConsoleManager, ProgressHandle
from .wireguard import WireGuardValueError, build_config, validate_key

FILE_NAME_MAX_BYTES = 15
DIRECTORY_MAX_BYTES = 64


class ServerClient(Protocol):
    async def get_geo(self) -> Coordinates: ...

    async def get_servers(self) -> list[object]: ...


class GenerationError(RuntimeError):
    pass


@dataclass(slots=True, frozen=True)
class FileJob:
    path: Path
    content: bytes


class FilePathAllocator:
    def __init__(self) -> None:
        self._used: set[Path] = set()
        self._next_suffix: dict[Path, int] = {}

    def allocate(self, directory: Path, name_root: str) -> Path:
        base = directory / name_root
        suffix = self._next_suffix.get(base, 0)
        while True:
            file_name = f"{name_root}.conf" if suffix == 0 else f"{name_root}_{suffix}.conf"
            candidate = directory / file_name
            suffix += 1
            if candidate in self._used:
                continue
            self._used.add(candidate)
            self._next_suffix[base] = suffix
            return candidate


class Generator:
    def __init__(
        self,
        client: ServerClient,
        ui: ConsoleManager,
        *,
        working_directory: Path | None = None,
        time_ns: Callable[[], int] = time.time_ns,
    ) -> None:
        self.client = client
        self.ui = ui
        self.stats = GenerationStats()
        self.working_directory = working_directory or Path.cwd()
        self._time_ns = time_ns

    async def process(self, private_key: str, preferences: UserPreferences) -> Path:
        self.stats = GenerationStats()
        preferences.validate()
        _validate_groups(preferences)
        try:
            validate_key(private_key)
        except WireGuardValueError as error:
            raise GenerationError(f"invalid private key: {error}") from error

        with self.ui.status("Fetching data..."):
            geo_task: asyncio.Task[Coordinates] = asyncio.create_task(self.client.get_geo())
            servers_task: asyncio.Task[list[object]] = asyncio.create_task(
                self.client.get_servers()
            )
            try:
                raw_servers = await servers_task
            except BaseException:
                geo_task.cancel()
                await asyncio.gather(geo_task, return_exceptions=True)
                raise
            if not raw_servers:
                geo_task.cancel()
                await asyncio.gather(geo_task, return_exceptions=True)
                raise GenerationError("server data was empty")
            try:
                coordinates = await geo_task
            except Exception:
                coordinates = None
        self.ui.success("Fetched server data")

        observer = coordinates
        if observer is None or not valid_coordinates(observer.latitude, observer.longitude):
            observer = None
            self.ui.info("Location unavailable; optimizing equal-load servers by name")

        with self.ui.status("Processing dataset..."):
            parsed = parse_servers(
                raw_servers,
                observer,
                preferences.groups,
                preferences.exclude_dedicated,
                preferences.use_ip,
            )
            parsed.sort(key=_server_sort_key)

            unique_servers: list[Server] = []
            seen_hostnames: set[str] = set()
            for server in parsed:
                if server.hostname in seen_hostnames:
                    continue
                seen_hostnames.add(server.hostname)
                unique_servers.append(server)
            if not unique_servers:
                raise GenerationError("no servers matched filters")

            best_servers: list[Server] = []
            seen_best: set[tuple[str, str, str]] = set()
            for server in unique_servers:
                key = (server.combo, server.country, server.city)
                if key in seen_best:
                    continue
                seen_best.add(key)
                best_servers.append(server)

            self.stats = GenerationStats(total=len(unique_servers), best=len(best_servers))
            output_name = _output_directory_name(self._time_ns())
            try:
                temporary_root = Path(
                    tempfile.mkdtemp(prefix=".nordgen-", dir=self.working_directory)
                )
            except OSError as error:
                raise GenerationError(f"create temporary output directory: {error}") from error
            try:
                secure_output_root(temporary_root)
                jobs = self._build_jobs(
                    temporary_root,
                    unique_servers,
                    "configs",
                    private_key,
                    preferences,
                )
                jobs.extend(
                    self._build_jobs(
                        temporary_root,
                        best_servers,
                        "best_configs",
                        private_key,
                        preferences,
                    )
                )
            except BaseException:
                shutil.rmtree(temporary_root, ignore_errors=True)
                raise
        self.ui.success("Dataset processed")

        committed = False
        try:
            await self._write_jobs(jobs)
            final_path = self.working_directory / output_name
            try:
                final_path.lstat()
            except FileNotFoundError:
                pass
            except OSError as error:
                raise GenerationError(f"inspect output destination: {error}") from error
            else:
                raise GenerationError(
                    f"commit output directory: destination already exists: {final_path}"
                )
            try:
                temporary_root.rename(final_path)
            except OSError as error:
                raise GenerationError(f"commit output directory: {error}") from error
            committed = True
            self.ui.success("Configuration files written")
            return final_path
        finally:
            if not committed:
                shutil.rmtree(temporary_root, ignore_errors=True)

    def _build_jobs(
        self,
        root: Path,
        servers: list[Server],
        subdirectory: str,
        private_key: str,
        preferences: UserPreferences,
    ) -> list[FileJob]:
        allocator = FilePathAllocator()
        jobs: list[FileJob] = []
        for server in servers:
            country = canonical_path_segment(server.country, DIRECTORY_MAX_BYTES)
            city = canonical_path_segment(server.city, DIRECTORY_MAX_BYTES)
            combo = canonical_path_segment(server.combo, DIRECTORY_MAX_BYTES)
            name_root = canonical_path_segment(server.name, FILE_NAME_MAX_BYTES)
            directory = root / subdirectory / combo / country / city
            path = allocator.allocate(directory, name_root)
            endpoint = server.station if preferences.use_ip else server.hostname
            try:
                content = build_config(
                    private_key,
                    server.public_key,
                    endpoint,
                    preferences.dns,
                    preferences.keepalive,
                )
            except WireGuardValueError as error:
                raise GenerationError(f"server {server.hostname}: {error}") from error
            jobs.append(FileJob(path, content))
        return jobs

    async def _write_jobs(self, jobs: list[FileJob]) -> None:
        if not jobs:
            return
        with self.ui.status("Preparing file system..."):
            directories = sorted({job.path.parent for job in jobs}, key=os.fspath)
            for directory in directories:
                directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.ui.success("File system prepared")

        stop_event = threading.Event()
        with self.ui.progress(len(jobs), "Writing all configs") as progress:
            write_task = asyncio.create_task(
                asyncio.to_thread(_write_jobs_parallel, jobs, progress, stop_event)
            )
            try:
                await asyncio.shield(write_task)
            except asyncio.CancelledError:
                stop_event.set()
                try:
                    await asyncio.shield(write_task)
                except Exception:
                    pass
                raise
        if stop_event.is_set():
            raise GenerationError("configuration write stopped before completion")


def canonical_path_segment(segment: str, maximum_bytes: int = 0) -> str:
    normalized = segment.strip().lower()
    mapped = "".join(
        "_"
        if unicodedata.category(character).startswith("C")
        or character.isspace()
        or character in '<>:"/\\|?*'
        else character
        for character in normalized
    )
    if maximum_bytes > 0:
        mapped = truncate_utf8(mapped, maximum_bytes)
    mapped = mapped.rstrip(". ")
    if mapped in {"", ".", ".."}:
        return "unknown"
    if _is_windows_reserved_name(mapped):
        mapped = f"_{mapped}"
        if maximum_bytes > 0:
            mapped = truncate_utf8(mapped, maximum_bytes)
        mapped = mapped.rstrip(". ")
        if mapped in {"", ".", ".."}:
            return "unknown"
    return mapped


def truncate_utf8(value: str, maximum_bytes: int) -> str:
    encoded = value.encode()
    if maximum_bytes <= 0 or len(encoded) <= maximum_bytes:
        return value
    truncated = encoded[:maximum_bytes]
    while truncated:
        try:
            return truncated.decode()
        except UnicodeDecodeError:
            truncated = truncated[:-1]
    return ""


def _is_windows_reserved_name(segment: str) -> bool:
    base = segment.split(".", 1)[0].upper()
    if base in {"CON", "PRN", "AUX", "NUL", "CLOCK$", "CONIN$", "CONOUT$"}:
        return True
    return len(base) == 4 and base[:3] in {"COM", "LPT"} and base[3] in "123456789¹²³"


def _validate_groups(preferences: UserPreferences) -> None:
    seen: set[str] = set()
    for group in preferences.groups:
        if group not in TYPE_GROUPS:
            raise ValueError(f'unknown server group identifier "{group}"')
        if group in seen:
            raise ValueError(f'duplicate server group identifier "{group}"')
        seen.add(group)
        if preferences.exclude_dedicated and group == GROUP_DEDICATED_ID:
            raise ValueError("cannot require the dedicated group while excluding dedicated servers")


def _server_sort_key(server: Server) -> tuple[int, float, str, str, str, str, str, str]:
    return (
        server.load,
        server.distance,
        server.hostname,
        server.combo,
        server.country,
        server.city,
        server.station,
        server.public_key,
    )


def _output_directory_name(now_ns: int) -> str:
    seconds, nanoseconds = divmod(now_ns, 1_000_000_000)
    timestamp = datetime.fromtimestamp(seconds).strftime("%Y%m%d_%H%M%S")
    return f"nordvpn_configs_{timestamp}_{nanoseconds:09d}"


def _write_jobs_parallel(
    jobs: list[FileJob],
    progress: ProgressHandle,
    stop_event: threading.Event,
) -> None:
    job_queue: queue.Queue[FileJob] = queue.Queue()
    for job in jobs:
        job_queue.put_nowait(job)

    worker_count = min(len(jobs), max(2, min(32, (os.cpu_count() or 1) * 2)))
    first_error: list[BaseException] = []
    error_lock = threading.Lock()

    def worker() -> None:
        while not stop_event.is_set():
            try:
                job = job_queue.get_nowait()
            except queue.Empty:
                return
            try:
                _write_file_exclusive(job.path, job.content)
                progress.advance()
            except BaseException as error:
                with error_lock:
                    if not first_error:
                        first_error.append(error)
                stop_event.set()
                return
            finally:
                job_queue.task_done()

    workers = [threading.Thread(target=worker, daemon=False) for _ in range(worker_count)]
    for thread in workers:
        thread.start()
    for thread in workers:
        thread.join()

    if first_error:
        raise GenerationError(f"write configuration files: {first_error[0]}") from first_error[0]
    if stop_event.is_set() or not job_queue.empty():
        raise GenerationError("configuration write stopped before completion")


def _write_file_exclusive(path: Path, content: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
        descriptor = -1
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        descriptor = -1
        try:
            path.unlink()
        except OSError:
            pass
        raise
    finally:
        if descriptor >= 0:
            os.close(descriptor)
