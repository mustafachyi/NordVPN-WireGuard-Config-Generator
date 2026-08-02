import getpass
from io import StringIO
from typing import Any

import pytest

import nord_config_generator.ui as ui_module
from nord_config_generator.models import GenerationStats, UserPreferences
from nord_config_generator.ui import (
    MAX_TOKEN_READ_BYTES,
    ConsoleManager,
    ConsoleOutputError,
    InputTooLongError,
    ProgressHandle,
)


class FailingWriter(StringIO):
    def write(self, value: str) -> int:
        raise OSError("write failed")


class BrokenTTY(StringIO):
    def isatty(self) -> bool:
        raise OSError("isatty failed")


def test_nonterminal_presentation_and_summary() -> None:
    output = StringIO()
    manager = ConsoleManager(StringIO(), output)
    manager.clear()
    manager.header()
    manager.success("Done")
    manager.fail("Failed")
    manager.info("Info")
    manager.show_key("key")
    manager.summary("configs", GenerationStats(total=2, best=1), 1.25)
    text = output.getvalue()
    for expected in [
        "NordVPN Configuration Generator",
        "Done",
        "Failed",
        "Info",
        "key",
        "Output Directory:",
        "configs",
        "3",
        "1.25s",
    ]:
        assert expected in text
    assert manager.output_error is None


def test_isatty_failures_are_treated_as_nonterminal() -> None:
    manager = ConsoleManager(BrokenTTY(), BrokenTTY())
    assert not manager.input_terminal
    assert not manager.output_terminal


def test_prompt_secret_nonterminal_boundaries() -> None:
    output = StringIO()
    manager = ConsoleManager(StringIO("  secret  \n"), output)
    assert manager.prompt_secret("Token") == "secret"
    assert "Token:" in output.getvalue()

    exact = "a" * MAX_TOKEN_READ_BYTES
    assert ConsoleManager(StringIO(exact + "\n"), StringIO()).prompt_secret("Token") == exact
    with pytest.raises(InputTooLongError):
        ConsoleManager(StringIO(exact + "a\n"), StringIO()).prompt_secret("Token")
    with pytest.raises(EOFError):
        ConsoleManager(StringIO(), StringIO()).prompt_secret("Token")
    manager = ConsoleManager(StringIO("unterminated"), StringIO())
    assert manager.prompt_secret("Token") == "unterminated"


def test_prompt_secret_terminal_uses_supported_getpass_signature(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    def masked(prompt: str, *, stream: Any, echo_char: str) -> str:
        calls.append({"prompt": prompt, "stream": stream, "echo_char": echo_char})
        return " secret "

    monkeypatch.setattr(getpass, "getpass", masked)
    output = StringIO()
    manager = ConsoleManager(StringIO(), output, input_terminal=True)
    assert manager.prompt_secret("Token") == "secret"
    assert calls[0]["echo_char"] == "*"

    def legacy(prompt: str, stream: Any = None) -> str:
        calls.append({"prompt": prompt, "stream": stream})
        return "legacy"

    monkeypatch.setattr(getpass, "getpass", legacy)
    assert manager.prompt_secret("Token") == "legacy"

    def too_long(prompt: str, stream: Any = None) -> str:
        return "x" * (MAX_TOKEN_READ_BYTES + 1)

    monkeypatch.setattr(getpass, "getpass", too_long)
    with pytest.raises(InputTooLongError):
        manager.prompt_secret("Token")

    def broken(prompt: str, stream: Any = None) -> str:
        raise OSError("broken")

    monkeypatch.setattr(getpass, "getpass", broken)
    with pytest.raises(OSError, match="masked terminal"):
        manager.prompt_secret("Token")


def test_prompt_preferences_reprompts_invalid_values_and_preserves_groups() -> None:
    values = "\nmaybe\nyes\nbad\n70000\n15\nno\n"
    output = StringIO()
    defaults = UserPreferences(
        dns="1.1.1.1",
        keepalive=25,
        groups=("legacy_standard",),
    )
    manager = ConsoleManager(StringIO(values), output)
    preferences = manager.prompt_preferences(defaults, frozenset())
    assert preferences == UserPreferences(
        dns="1.1.1.1",
        use_ip=True,
        keepalive=15,
        groups=("legacy_standard",),
        exclude_dedicated=False,
    )
    assert "Enter yes or no" in output.getvalue()
    assert "between 0 and 65535" in output.getvalue()


def test_prompt_preferences_validates_dns_and_respects_provided() -> None:
    manager = ConsoleManager(StringIO("bad\n2001:0db8::1\n"), StringIO())
    preferences = manager.prompt_preferences(
        UserPreferences(),
        frozenset({"use_ip", "keepalive", "exclude_dedicated"}),
    )
    assert preferences.dns == "2001:db8::1"

    manager = ConsoleManager(StringIO(), StringIO())
    defaults = UserPreferences(dns="1.1.1.1", use_ip=True, keepalive=7, exclude_dedicated=True)
    assert (
        manager.prompt_preferences(
            defaults,
            frozenset({"dns", "use_ip", "keepalive", "exclude_dedicated"}),
        )
        == defaults
    )


def test_prompt_helpers_use_defaults_after_eof_and_long_input() -> None:
    manager = ConsoleManager(StringIO(), StringIO())
    assert manager._prompt_string("Value", "default") == "default"
    assert manager._prompt_bool("Enabled", True)
    assert manager._prompt_int("Number", 7, 0, 10) == 7

    manager = ConsoleManager(StringIO("x" * 17 + "\n"), StringIO())
    assert not manager._prompt_bool("Enabled", False)


def test_status_and_progress_nonterminal_preserve_body_exceptions() -> None:
    output = StringIO()
    manager = ConsoleManager(StringIO(), output)
    with manager.status("Working"):
        pass
    with manager.progress(2, "Writing") as progress:
        progress.advance(2)
    with manager.progress(0, "Writing") as progress:
        progress.advance()
    assert output.getvalue() == "Working\n"

    with pytest.raises(ValueError, match="body"):
        with manager.status("Body"):
            raise ValueError("body")
    with pytest.raises(ValueError, match="body"):
        with manager.progress(2, "Writing"):
            raise ValueError("body")


class FakeStatus:
    def __init__(
        self,
        *,
        start_error: BaseException | None = None,
        stop_error: BaseException | None = None,
    ) -> None:
        self.start_error = start_error
        self.stop_error = stop_error
        self.started = False
        self.stopped = False

    def start(self) -> None:
        if self.start_error:
            raise self.start_error
        self.started = True

    def stop(self) -> None:
        self.stopped = True
        if self.stop_error:
            raise self.stop_error


class FakeProgress:
    advance_error: BaseException | None = None

    def __init__(self, *args: object, **kwargs: object) -> None:
        self.started = False
        self.stopped = False
        self.advanced = 0

    def start(self) -> None:
        self.started = True

    def stop(self) -> None:
        self.stopped = True

    def add_task(self, message: str, total: int) -> int:
        assert message == "Writing"
        assert total == 2
        return 3

    def advance(self, task_id: int, amount: int) -> None:
        assert task_id == 3
        if self.advance_error is not None:
            raise self.advance_error
        self.advanced += amount


def test_terminal_status_and_progress_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = ConsoleManager(StringIO(), StringIO(), output_terminal=True)
    status = FakeStatus()
    monkeypatch.setattr(manager.console, "status", lambda *args, **kwargs: status)
    with manager.status("Working"):
        pass
    assert status.started and status.stopped

    monkeypatch.setattr(ui_module, "Progress", FakeProgress)
    with manager.progress(2, "Writing") as progress:
        progress.advance()
        progress.advance(2)
    assert isinstance(progress, ProgressHandle)
    assert progress._progress.advanced == 3


def test_terminal_progress_records_render_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = ConsoleManager(StringIO(), StringIO(), output_terminal=True)
    monkeypatch.setattr(ui_module, "Progress", FakeProgress)
    FakeProgress.advance_error = OSError("advance")
    try:
        with pytest.raises(ConsoleOutputError):
            with manager.progress(2, "Writing") as progress:
                progress.advance()
    finally:
        FakeProgress.advance_error = None
    assert manager.output_error is not None


def test_terminal_status_start_and_stop_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = ConsoleManager(StringIO(), StringIO(), output_terminal=True)
    monkeypatch.setattr(
        manager.console,
        "status",
        lambda *args, **kwargs: FakeStatus(start_error=OSError("start")),
    )
    with pytest.raises(ConsoleOutputError):
        with manager.status("Working"):
            pass
    assert manager.output_error is not None

    manager = ConsoleManager(StringIO(), StringIO(), output_terminal=True)
    stopping = FakeStatus(stop_error=OSError("stop"))
    monkeypatch.setattr(manager.console, "status", lambda *args, **kwargs: stopping)
    with manager.status("Working"):
        pass
    assert manager.output_error is not None


def test_output_errors_are_sticky() -> None:
    manager = ConsoleManager(StringIO(), FailingWriter())
    with pytest.raises(ConsoleOutputError):
        manager.success("first")
    first = manager.output_error
    assert first is not None
    with pytest.raises(ConsoleOutputError):
        manager.info("second")
    assert manager.output_error is first


def test_clear_and_wait_terminal_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    output = StringIO()
    manager = ConsoleManager(StringIO("\n"), output, input_terminal=True, output_terminal=True)
    cleared = False

    def clear() -> None:
        nonlocal cleared
        cleared = True

    monkeypatch.setattr(manager.console, "clear", clear)
    manager.clear()
    manager.wait()
    assert cleared
    assert "Press Enter" in output.getvalue()

    manager = ConsoleManager(StringIO(), StringIO(), input_terminal=False)
    manager.wait()
