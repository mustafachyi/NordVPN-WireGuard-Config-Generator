import asyncio
import math
import os
import stat
import threading
from io import StringIO
from pathlib import Path

import pytest

from nord_config_generator.constants import (
    GROUP_DEDICATED_ID,
    GROUP_P2P_ID,
    GROUP_STANDARD_ID,
)
from nord_config_generator.generator import (
    DIRECTORY_MAX_BYTES,
    FileJob,
    FilePathAllocator,
    GenerationError,
    Generator,
    _output_directory_name,
    _server_sort_key,
    _validate_groups,
    _write_file_exclusive,
    _write_jobs_parallel,
    canonical_path_segment,
    truncate_utf8,
)
from nord_config_generator.models import (
    Coordinates,
    Server,
    UserPreferences,
)
from nord_config_generator.ui import (
    ConsoleManager,
    ConsoleOutputError,
    ProgressHandle,
)


class FakeClient:
    def __init__(
        self,
        servers: list[object] | None = None,
        coordinates: Coordinates | None = None,
        *,
        server_error: BaseException | None = None,
        geo_error: BaseException | None = None,
    ) -> None:
        self.servers = servers or []
        self.coordinates = coordinates or Coordinates(0, 0)
        self.server_error = server_error
        self.geo_error = geo_error

    async def get_servers(
        self,
    ) -> list[object]:
        if self.server_error is not None:
            raise self.server_error

        return self.servers

    async def get_geo(
        self,
    ) -> Coordinates:
        if self.geo_error is not None:
            raise self.geo_error

        return self.coordinates


class PatternFailingWriter(StringIO):
    def __init__(
        self,
        rejected_text: str,
    ) -> None:
        super().__init__()
        self.rejected_text = rejected_text

    def write(
        self,
        value: str,
    ) -> int:
        if self.rejected_text in value:
            raise OSError("write failed")

        return super().write(value)


def make_ui(
    output: StringIO | None = None,
) -> ConsoleManager:
    return ConsoleManager(
        StringIO(),
        output or StringIO(),
    )


def server_model(
    name: str,
    key: str,
    **changes: object,
) -> Server:
    values: dict[str, object] = {
        "name": name,
        "hostname": (f"{name}.example.com"),
        "station": "192.0.2.1",
        "load": 10,
        "country": "Country",
        "city": "City",
        "public_key": key,
        "distance": 1.0,
        "combo": "standard",
    }
    values.update(changes)
    return Server(**values)  # type: ignore[arg-type]


def test_canonical_path_segments_and_utf8_bounds() -> None:
    cases = {
        "": "unknown",
        "   ": "unknown",
        ".": "unknown",
        "..": "unknown",
        "New York": "new_york",
        "A/B:C*D?": "a_b_c_d_",
        "name.": "name",
        "CON": "_con",
        "lpt9.txt": "_lpt9.txt",
        "München": "münchen",
        "line\nbreak": ("line_break"),
        "name\u202econf": ("name_conf"),
        "COM¹": "_com¹",
    }

    for value, expected in cases.items():
        assert canonical_path_segment(value) == expected

    assert (
        truncate_utf8(
            "ééé",
            5,
        )
        == "éé"
    )
    assert (
        truncate_utf8(
            "abc",
            5,
        )
        == "abc"
    )
    assert (
        truncate_utf8(
            "é",
            1,
        )
        == ""
    )

    bounded = canonical_path_segment(
        "界" * 100,
        DIRECTORY_MAX_BYTES,
    )
    assert len(bounded.encode()) <= DIRECTORY_MAX_BYTES

    value = "a" * (DIRECTORY_MAX_BYTES - 1) + ".suffix"
    assert canonical_path_segment(
        value,
        DIRECTORY_MAX_BYTES,
    ) == ("a" * (DIRECTORY_MAX_BYTES - 1))


def test_file_path_allocator_resolves_all_collision_forms(
    tmp_path: Path,
) -> None:
    allocator = FilePathAllocator()
    directory = tmp_path / "configs"

    assert (
        allocator.allocate(
            directory,
            "same",
        ).name
        == "same.conf"
    )
    assert (
        allocator.allocate(
            directory,
            "same",
        ).name
        == "same_1.conf"
    )
    assert (
        allocator.allocate(
            directory,
            "same_1",
        ).name
        == "same_1_1.conf"
    )
    assert (
        allocator.allocate(
            directory,
            "same_1",
        ).name
        == "same_1_2.conf"
    )


@pytest.mark.asyncio
async def test_process_writes_atomic_private_output(
    tmp_path: Path,
    key_factory,
    server_factory,
) -> None:
    servers = [
        server_factory(
            "us2.example.com",
            20,
        ),
        server_factory(
            "us1.example.com",
            10,
        ),
        server_factory(
            "us1.example.com",
            50,
        ),
    ]
    output = StringIO()
    generator = Generator(
        FakeClient(
            servers,
            Coordinates(0, 0),
        ),
        make_ui(output),
        working_directory=tmp_path,
        time_ns=lambda: 123_456_789,
    )

    path = await generator.process(
        key_factory(1),
        UserPreferences(
            dns="1.1.1.1",
            keepalive=25,
        ),
    )

    assert path.parent == tmp_path
    assert path.name == (_output_directory_name(123_456_789))
    assert generator.stats.total == 2
    assert generator.stats.best == 1

    configs = sorted(path.rglob("*.conf"))
    assert len(configs) == 3

    best = next((path / "best_configs").rglob("*.conf"))
    assert "Endpoint = us1.example.com:51820" in best.read_text()

    if os.name != "nt":
        directories = [path]
        directories.extend(candidate for candidate in path.rglob("*") if candidate.is_dir())

        for directory in directories:
            assert stat.S_IMODE(directory.stat().st_mode) == 0o700, directory

        for config in configs:
            assert stat.S_IMODE(config.stat().st_mode) == 0o600, config

    assert not list(tmp_path.glob(".nordgen-*"))
    assert "Configuration files written" in output.getvalue()


@pytest.mark.asyncio
async def test_process_falls_back_when_geolocation_fails(
    tmp_path: Path,
    key_factory,
    server_factory,
) -> None:
    servers = [
        server_factory(
            "z.example.com",
            10,
            50,
            50,
        ),
        server_factory(
            "a.example.com",
            10,
            -50,
            -50,
        ),
    ]
    output = StringIO()
    generator = Generator(
        FakeClient(
            servers,
            geo_error=RuntimeError("unavailable"),
        ),
        make_ui(output),
        working_directory=tmp_path,
    )

    path = await generator.process(
        key_factory(1),
        UserPreferences(
            dns="1.1.1.1",
            keepalive=25,
        ),
    )

    best = next((path / "best_configs").rglob("*.conf"))
    assert "Endpoint = a.example.com:51820" in best.read_text()
    assert "Location unavailable" in output.getvalue()


class BlockingGeoClient:
    def __init__(self) -> None:
        self.cancelled = asyncio.Event()

    async def get_servers(
        self,
    ) -> list[object]:
        raise RuntimeError("server failed")

    async def get_geo(
        self,
    ) -> Coordinates:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled.set()
            raise


@pytest.mark.asyncio
async def test_process_cancels_optional_geo_when_server_fetch_fails(
    key_factory,
) -> None:
    client = BlockingGeoClient()
    generator = Generator(
        client,
        make_ui(),
    )

    with pytest.raises(
        RuntimeError,
        match="server failed",
    ):
        await generator.process(
            key_factory(1),
            UserPreferences(
                dns="1.1.1.1",
                keepalive=25,
            ),
        )

    await asyncio.wait_for(
        client.cancelled.wait(),
        timeout=1,
    )


@pytest.mark.asyncio
async def test_process_rejects_invalid_inputs_and_unusable_data(
    tmp_path: Path,
    key_factory,
    server_factory,
) -> None:
    preferences = UserPreferences(
        dns="1.1.1.1",
        keepalive=25,
    )
    generator = Generator(
        FakeClient(),
        make_ui(),
        working_directory=tmp_path,
    )

    with pytest.raises(
        GenerationError,
        match="invalid private key",
    ):
        await generator.process(
            "bad",
            preferences,
        )

    with pytest.raises(
        ValueError,
        match="DNS",
    ):
        await generator.process(
            key_factory(1),
            UserPreferences(dns="bad"),
        )

    with pytest.raises(
        ValueError,
        match="unknown server group",
    ):
        await generator.process(
            key_factory(1),
            UserPreferences(
                dns="1.1.1.1",
                groups=("unknown",),
            ),
        )

    with pytest.raises(
        GenerationError,
        match="server data was empty",
    ):
        await generator.process(
            key_factory(1),
            preferences,
        )

    invalid = server_factory(
        "invalid",
        10,
    )
    generator = Generator(
        FakeClient([invalid]),
        make_ui(),
        working_directory=tmp_path,
    )

    with pytest.raises(
        GenerationError,
        match="no servers matched",
    ):
        await generator.process(
            key_factory(1),
            preferences,
        )


@pytest.mark.asyncio
async def test_process_cleans_temporary_output_on_commit_collision(
    tmp_path: Path,
    key_factory,
    server_factory,
) -> None:
    fixed_ns = 999
    destination = tmp_path / _output_directory_name(fixed_ns)
    destination.mkdir()
    (destination / "existing").write_text("x")

    generator = Generator(
        FakeClient([server_factory()]),
        make_ui(),
        working_directory=tmp_path,
        time_ns=lambda: fixed_ns,
    )

    with pytest.raises(
        GenerationError,
        match="destination already exists",
    ):
        await generator.process(
            key_factory(1),
            UserPreferences(
                dns="1.1.1.1",
                keepalive=25,
            ),
        )

    assert (destination / "existing").read_text() == "x"
    assert not list(tmp_path.glob(".nordgen-*"))


@pytest.mark.asyncio
async def test_process_cleans_temporary_output_after_post_build_output_failure(
    tmp_path: Path,
    key_factory,
    server_factory,
) -> None:
    output = PatternFailingWriter("Dataset processed")
    generator = Generator(
        FakeClient([server_factory()]),
        make_ui(output),
        working_directory=tmp_path,
        time_ns=lambda: 999,
    )

    with pytest.raises(
        ConsoleOutputError,
        match="write console output",
    ):
        await generator.process(
            key_factory(1),
            UserPreferences(
                dns="1.1.1.1",
                keepalive=25,
            ),
        )

    assert not list(tmp_path.glob(".nordgen-*"))
    assert not list(tmp_path.glob("nordvpn_configs_*"))


@pytest.mark.asyncio
async def test_process_rejects_invalid_working_directory(
    tmp_path: Path,
    key_factory,
    server_factory,
) -> None:
    file_path = tmp_path / "file"
    file_path.write_text("x")

    generator = Generator(
        FakeClient([server_factory()]),
        make_ui(),
        working_directory=file_path,
    )

    with pytest.raises(
        GenerationError,
        match="temporary output",
    ):
        await generator.process(
            key_factory(1),
            UserPreferences(
                dns="1.1.1.1",
                keepalive=25,
            ),
        )


@pytest.mark.asyncio
async def test_write_jobs_rejects_path_outside_output_root(
    tmp_path: Path,
) -> None:
    root = tmp_path / "root"
    root.mkdir(mode=0o700)

    outside_path = tmp_path / "outside" / "config.conf"
    generator = Generator(
        FakeClient(),
        make_ui(),
    )

    with pytest.raises(
        GenerationError,
        match="escapes output root",
    ):
        await generator._write_jobs(
            root,
            [
                FileJob(
                    outside_path,
                    b"configuration",
                )
            ],
        )

    assert not outside_path.exists()


def test_build_jobs_resolves_names_and_uses_ipv6(
    key_factory,
    tmp_path: Path,
) -> None:
    generator = Generator(
        FakeClient(),
        make_ui(),
    )
    servers = [
        server_model(
            "same",
            key_factory(2),
        ),
        server_model(
            "same",
            key_factory(3),
            hostname=("same.two.example.com"),
        ),
        server_model(
            "same_1",
            key_factory(4),
            hostname=("same.three.example.com"),
        ),
        server_model(
            "abcdefghijklmno-one",
            key_factory(5),
            hostname=("long.one.example.com"),
        ),
        server_model(
            "abcdefghijklmno-two",
            key_factory(6),
            hostname=("long.two.example.com"),
        ),
        server_model(
            "a/b",
            key_factory(7),
            hostname=("sanitize.one.example.com"),
        ),
        server_model(
            "a:b",
            key_factory(8),
            hostname=("sanitize.two.example.com"),
        ),
    ]

    jobs = generator._build_jobs(
        tmp_path,
        servers,
        "configs",
        key_factory(1),
        UserPreferences(
            dns="1.1.1.1",
            keepalive=25,
        ),
    )

    assert [job.path.name for job in jobs] == [
        "same.conf",
        "same_1.conf",
        "same_1_1.conf",
        "abcdefghijklmno.conf",
        "abcdefghijklmno_1.conf",
        "a_b.conf",
        "a_b_1.conf",
    ]

    ipv6 = server_model(
        "server",
        key_factory(2),
        station="2001:db8::1",
    )
    jobs = generator._build_jobs(
        tmp_path,
        [ipv6],
        "configs",
        key_factory(1),
        UserPreferences(
            dns="1.1.1.1",
            keepalive=25,
            use_ip=True,
        ),
    )

    assert b"Endpoint = [2001:db8::1]:51820" in jobs[0].content

    bad = server_model(
        "bad",
        "invalid",
    )

    with pytest.raises(
        GenerationError,
        match=(r"server bad\.example\.com"),
    ):
        generator._build_jobs(
            tmp_path,
            [bad],
            "configs",
            key_factory(1),
            UserPreferences(
                dns="1.1.1.1",
                keepalive=25,
            ),
        )


def test_group_validation_and_server_sorting(
    key_factory,
) -> None:
    _validate_groups(
        UserPreferences(
            groups=(
                GROUP_STANDARD_ID,
                GROUP_P2P_ID,
            )
        )
    )

    with pytest.raises(
        ValueError,
        match="duplicate",
    ):
        _validate_groups(
            UserPreferences(
                groups=(
                    GROUP_STANDARD_ID,
                    GROUP_STANDARD_ID,
                )
            )
        )

    with pytest.raises(
        ValueError,
        match="dedicated",
    ):
        _validate_groups(
            UserPreferences(
                groups=(GROUP_DEDICATED_ID,),
                exclude_dedicated=True,
            )
        )

    base = server_model(
        "b",
        key_factory(1),
    )
    later = server_model(
        "c",
        key_factory(2),
        load=11,
    )

    assert _server_sort_key(base) < _server_sort_key(later)


def test_write_file_exclusive_does_not_overwrite_and_cleans_partial(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "config.conf"
    path.write_bytes(b"existing")

    with pytest.raises(FileExistsError):
        _write_file_exclusive(
            path,
            b"replacement",
        )

    assert path.read_bytes() == b"existing"

    partial = tmp_path / "partial.conf"

    class BrokenFile:
        def __enter__(self):
            return self

        def __exit__(
            self,
            *args: object,
        ) -> None:
            return None

        def write(
            self,
            content: bytes,
        ) -> None:
            raise OSError("write failed")

    monkeypatch.setattr(
        os,
        "fdopen",
        lambda descriptor, mode: BrokenFile(),
    )

    with pytest.raises(
        OSError,
        match="write failed",
    ):
        _write_file_exclusive(
            partial,
            b"value",
        )

    assert not partial.exists()


def test_write_jobs_parallel_success_failure_and_stop(
    tmp_path: Path,
) -> None:
    jobs = [
        FileJob(
            tmp_path / f"{index}.conf",
            b"x",
        )
        for index in range(4)
    ]
    progress = ProgressHandle(
        None,
        None,
    )
    stop = threading.Event()

    _write_jobs_parallel(
        jobs,
        progress,
        stop,
    )

    assert all(job.path.read_bytes() == b"x" for job in jobs)

    existing = tmp_path / "existing.conf"
    existing.write_bytes(b"x")

    with pytest.raises(
        GenerationError,
        match="write configuration files",
    ):
        _write_jobs_parallel(
            [
                FileJob(
                    existing,
                    b"y",
                )
            ],
            progress,
            threading.Event(),
        )

    stopped = threading.Event()
    stopped.set()

    with pytest.raises(
        GenerationError,
        match="stopped before completion",
    ):
        _write_jobs_parallel(
            [
                FileJob(
                    tmp_path / "never.conf",
                    b"x",
                )
            ],
            progress,
            stopped,
        )


@pytest.mark.parametrize(
    "coordinates",
    [
        Coordinates(
            math.nan,
            0,
        ),
        Coordinates(
            math.inf,
            0,
        ),
        Coordinates(
            -math.inf,
            0,
        ),
        Coordinates(
            91,
            0,
        ),
        Coordinates(
            0,
            181,
        ),
    ],
)
@pytest.mark.asyncio
async def test_process_falls_back_for_invalid_observer_coordinates(
    coordinates: Coordinates,
    tmp_path: Path,
    key_factory,
    server_factory,
) -> None:
    servers = [
        server_factory(
            "z.example.com",
            10,
            50,
            50,
        ),
        server_factory(
            "a.example.com",
            10,
            -50,
            -50,
        ),
    ]
    output = StringIO()
    generator = Generator(
        FakeClient(
            servers,
            coordinates,
        ),
        make_ui(output),
        working_directory=tmp_path,
        time_ns=lambda: 999,
    )

    path = await generator.process(
        key_factory(1),
        UserPreferences(
            dns="1.1.1.1",
            keepalive=25,
        ),
    )

    best = next((path / "best_configs").rglob("*.conf"))
    assert "Endpoint = a.example.com:51820" in best.read_text()
    assert "Location unavailable" in output.getvalue()
