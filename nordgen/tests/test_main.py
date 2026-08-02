import asyncio
import signal
import sys
from contextlib import AbstractAsyncContextManager
from io import StringIO
from pathlib import Path
from types import TracebackType

import pytest

import nord_config_generator.main as main_module
from nord_config_generator.client import NordClientError, UnauthorizedError
from nord_config_generator.constants import (
    GROUP_DEDICATED_ID,
    GROUP_P2P_ID,
    GROUP_STANDARD_ID,
)
from nord_config_generator.main import (
    GenerateOptions,
    UsageError,
    _handle_runtime_error,
    contains_help,
    parse_generate_options,
    parse_get_key_options,
    resolve_command,
    resolve_private_key,
    run,
    run_generate,
    run_get_key,
    validate_token,
)
from nord_config_generator.models import Coordinates, UserPreferences
from nord_config_generator.ui import ConsoleManager, ConsoleOutputError


class FakeAPI(AbstractAsyncContextManager["FakeAPI"]):
    def __init__(
        self,
        *,
        key: str,
        servers: list[object] | None = None,
        coordinates: Coordinates | None = None,
        key_error: BaseException | None = None,
        server_error: BaseException | None = None,
    ) -> None:
        self.key = key
        self.servers = servers or []
        self.coordinates = coordinates if coordinates is not None else Coordinates(0, 0)
        self.key_error = key_error
        self.server_error = server_error
        self.entered = False
        self.exited = False
        self.tokens: list[str] = []

    async def __aenter__(self) -> "FakeAPI":
        self.entered = True
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.exited = True

    async def get_key(self, token: str) -> str:
        self.tokens.append(token)
        if self.key_error is not None:
            raise self.key_error
        return self.key

    async def get_geo(self) -> Coordinates:
        return self.coordinates

    async def get_servers(self) -> list[object]:
        if self.server_error is not None:
            raise self.server_error
        return self.servers


class FailingWriter(StringIO):
    def write(self, value: str) -> int:
        raise OSError("write failed")


def make_ui(input_value: str = "") -> tuple[ConsoleManager, StringIO]:
    output = StringIO()
    return ConsoleManager(StringIO(input_value), output), output


def test_command_resolution_and_help_detection() -> None:
    assert contains_help(["generate", "--help"])
    assert not contains_help(["generate"])
    assert resolve_command([]) == ("generate", [])
    assert resolve_command(["-i"]) == ("generate", ["-i"])
    assert resolve_command(["generate", "-i"]) == ("generate", ["-i"])
    assert resolve_command(["get-key", "-t", "x"]) == ("get-key", ["-t", "x"])
    assert resolve_command(["help"]) == ("help", [])
    with pytest.raises(UsageError, match="unknown command"):
        resolve_command(["unknown"])
    with pytest.raises(UsageError, match="does not accept"):
        resolve_command(["help", "extra"])


def test_parse_generate_options_normalizes_and_validates() -> None:
    options = parse_generate_options(
        [
            "-t",
            "a" * 64,
            "-d",
            "1.1.1.1",
            "-k",
            "15",
            "-i",
            "-g",
            "standard",
            "p2p",
            "-g",
            "STANDARD",
        ]
    )
    assert options.token == "a" * 64
    assert options.preferences == UserPreferences(
        dns="1.1.1.1",
        use_ip=True,
        keepalive=15,
        groups=(GROUP_STANDARD_ID, GROUP_P2P_ID),
    )
    assert {"token", "dns", "keepalive", "use_ip", "group"} <= options.provided

    defaults = parse_generate_options([])
    assert defaults.preferences == UserPreferences()
    assert not defaults.provided

    invalid = [
        ["-g", "unknown"],
        ["-e", "-g", "dedicated"],
        ["-d", "not-an-ip"],
        ["-k", "65536"],
        ["unexpected"],
        ["-g"],
        ["--unknown"],
    ]
    for args in invalid:
        with pytest.raises(UsageError):
            parse_generate_options(args)


def test_parse_get_key_and_validate_token() -> None:
    token = "aB" * 32
    assert parse_get_key_options(["--token", token]) == token
    assert parse_get_key_options([]) == ""
    with pytest.raises(UsageError):
        parse_get_key_options(["extra"])
    assert validate_token(f" {token} ") == token
    for value in ["", "a" * 63, "g" * 64]:
        with pytest.raises(ValueError, match="64 hexadecimal"):
            validate_token(value)


@pytest.mark.asyncio
async def test_resolve_private_key_success_prompt_and_failures(key_factory) -> None:
    key = key_factory(1)
    ui, output = make_ui()
    client = FakeAPI(key=key)
    assert await resolve_private_key(ui, client, "a" * 64) == key
    assert client.tokens == ["a" * 64]
    assert "Token validated" in output.getvalue()

    ui, _ = make_ui("b" * 64 + "\n")
    client = FakeAPI(key=key)
    assert await resolve_private_key(ui, client, "") == key
    assert client.tokens == ["b" * 64]

    ui, _ = make_ui()
    with pytest.raises(RuntimeError, match="rejected"):
        await resolve_private_key(
            ui,
            FakeAPI(key=key, key_error=UnauthorizedError("HTTP 401")),
            "a" * 64,
        )
    with pytest.raises(RuntimeError, match="retrieve NordLynx"):
        await resolve_private_key(
            ui,
            FakeAPI(key=key, key_error=NordClientError("network")),
            "a" * 64,
        )
    with pytest.raises(RuntimeError, match="invalid private key"):
        await resolve_private_key(ui, FakeAPI(key="invalid"), "a" * 64)


@pytest.mark.asyncio
async def test_run_get_key_success_and_runtime_errors(key_factory) -> None:
    ui, output = make_ui()
    assert await run_get_key(ui, FakeAPI(key=key_factory(1)), "a" * 64) == 0
    assert key_factory(1) in output.getvalue()

    ui, output = make_ui()
    assert await run_get_key(ui, FakeAPI(key=key_factory(1)), "bad") == 1
    assert "64 hexadecimal" in output.getvalue()


@pytest.mark.asyncio
async def test_run_generate_noninteractive_and_interactive(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, key_factory, server_factory
) -> None:
    monkeypatch.chdir(tmp_path)
    options = GenerateOptions(
        token="a" * 64,
        preferences=UserPreferences(dns="1.1.1.1", keepalive=25),
        provided=frozenset({"token"}),
    )
    ui, output = make_ui()
    code = await run_generate(
        ui,
        FakeAPI(key=key_factory(1), servers=[server_factory()]),
        options,
    )
    assert code == 0
    assert len(list(tmp_path.glob("nordvpn_configs_*"))) == 1
    assert "Output Directory" in output.getvalue()

    interactive_dir = tmp_path / "interactive"
    interactive_dir.mkdir()
    monkeypatch.chdir(interactive_dir)
    ui, _ = make_ui("a" * 64 + "\n\n\n\n\n")
    code = await run_generate(
        ui,
        FakeAPI(key=key_factory(1), servers=[server_factory()]),
        GenerateOptions("", UserPreferences(), frozenset()),
    )
    assert code == 0
    assert len(list(interactive_dir.glob("nordvpn_configs_*"))) == 1


@pytest.mark.asyncio
async def test_run_generate_failure_and_cancellation(key_factory, server_factory) -> None:
    ui, output = make_ui()
    options = GenerateOptions(
        "a" * 64,
        UserPreferences(dns="invalid", keepalive=25),
        frozenset({"token"}),
    )
    assert await run_generate(ui, FakeAPI(key=key_factory(1)), options) == 1
    assert "DNS" in output.getvalue()

    ui, output = make_ui()
    conflict = GenerateOptions(
        "a" * 64,
        UserPreferences(
            dns="1.1.1.1",
            groups=(GROUP_DEDICATED_ID,),
            exclude_dedicated=True,
        ),
        frozenset({"token"}),
    )
    assert await run_generate(ui, FakeAPI(key=key_factory(1)), conflict) == 1
    assert "dedicated" in output.getvalue()

    ui, output = make_ui()
    cancelled = FakeAPI(key=key_factory(1), key_error=asyncio.CancelledError())
    valid = GenerateOptions(
        "a" * 64,
        UserPreferences(dns="1.1.1.1"),
        frozenset({"token"}),
    )
    assert await run_generate(ui, cancelled, valid) == 130
    assert "cancelled" in output.getvalue().lower()


@pytest.mark.asyncio
async def test_run_dispatches_commands_and_exit_codes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, key_factory, server_factory
) -> None:
    monkeypatch.chdir(tmp_path)

    async def execute(args: list[str], client: FakeAPI, input_value: str = "") -> tuple[int, str]:
        output = StringIO()
        code = await run(args, StringIO(input_value), output, client_factory=lambda: client)
        assert client.entered == client.exited
        return code, output.getvalue()

    client = FakeAPI(key=key_factory(1))
    code, text = await execute(["help"], client)
    assert code == 0 and "USAGE" in text and not client.entered

    client = FakeAPI(key=key_factory(1))
    code, text = await execute(["generate", "--help"], client)
    assert code == 0 and "USAGE" in text and not client.entered

    client = FakeAPI(key=key_factory(1))
    code, text = await execute(["unknown"], client)
    assert code == 2 and "unknown command" in text and "USAGE" in text

    client = FakeAPI(key=key_factory(1))
    code, text = await execute(["generate", "--unknown"], client)
    assert code == 2 and "unrecognized" in text

    client = FakeAPI(key=key_factory(1))
    code, text = await execute(["get-key", "-t", "a" * 64], client)
    assert code == 0 and key_factory(1) in text

    client = FakeAPI(key=key_factory(1), servers=[server_factory()])
    code, text = await execute(["-t", "a" * 64], client)
    assert code == 0 and "Complete" in text

    client = FakeAPI(key=key_factory(1), server_error=NordClientError("failed"))
    code, text = await execute(["-t", "a" * 64], client)
    assert code == 1 and "failed" in text


@pytest.mark.asyncio
async def test_run_handles_output_and_factory_failures(key_factory) -> None:
    with pytest.raises(OSError):
        FailingWriter().write("x")
    code = await run(
        ["help"],
        StringIO(),
        FailingWriter(),
        client_factory=lambda: FakeAPI(key=key_factory(1)),
    )
    assert code == 1

    class BrokenContext(AbstractAsyncContextManager[FakeAPI]):
        async def __aenter__(self) -> FakeAPI:
            raise OSError("factory failed")

        async def __aexit__(self, *args: object) -> None:
            return None

    output = StringIO()
    code = await run(
        ["get-key", "-t", "a" * 64],
        StringIO(),
        output,
        client_factory=BrokenContext,
    )
    assert code == 1
    assert "factory failed" in output.getvalue()


def test_handle_runtime_error_reports_cancel_and_output_failure() -> None:
    ui, output = make_ui()
    assert _handle_runtime_error(ui, asyncio.CancelledError(), False) == 130
    assert "cancelled" in output.getvalue().lower()
    assert _handle_runtime_error(ui, RuntimeError("failed"), False) == 1

    class BrokenUI:
        def fail(self, message: str) -> None:
            raise ConsoleOutputError("failed")

        def wait(self) -> None:
            raise AssertionError

    broken_ui = BrokenUI()
    result = _handle_runtime_error(
        broken_ui,  # type: ignore[arg-type]
        RuntimeError("failed"),
        True,
    )
    assert result == 1


def test_cli_entry_point_restores_signal_and_exits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sys, "argv", ["nordgen", "help"])
    monkeypatch.setattr(asyncio, "run", lambda coroutine: (coroutine.close(), 7)[1])
    previous = signal.getsignal(signal.SIGTERM)
    with pytest.raises(SystemExit) as error:
        main_module.cli_entry_point()
    assert error.value.code == 7
    assert signal.getsignal(signal.SIGTERM) == previous


def test_cli_entry_point_translates_keyboard_interrupt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sys, "argv", ["nordgen"])

    def interrupted(coroutine: object) -> int:
        coroutine.close()  # type: ignore[attr-defined]
        raise KeyboardInterrupt

    monkeypatch.setattr(asyncio, "run", interrupted)
    with pytest.raises(SystemExit) as error:
        main_module.cli_entry_point()
    assert error.value.code == 130
