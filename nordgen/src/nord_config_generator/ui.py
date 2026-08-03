import getpass
import inspect
import sys
import threading
import warnings
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from ipaddress import ip_address
from typing import Any, TextIO, cast

from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskID,
    TextColumn,
)
from rich.table import Table
from rich.text import Text
from rich.theme import Theme

from .models import (
    MAX_KEEPALIVE,
    GenerationStats,
    UserPreferences,
)

MAX_TOKEN_READ_BYTES = 1024
MAX_LINE_DISCARD_BYTES = 4096

_THEME = Theme(
    {
        "info": "bright_cyan",
        "success": "bold bright_green",
        "error": "bold bright_red",
        "title": "bold bright_white",
        "muted": "white",
    }
)


class ConsoleOutputError(OSError):
    pass


class InputTooLongError(ValueError):
    pass


class ProgressHandle:
    def __init__(
        self,
        progress: Progress | None,
        task_id: TaskID | None,
        record_error: (
            Callable[
                [BaseException],
                None,
            ]
            | None
        ) = None,
    ) -> None:
        self._progress = progress
        self._task_id = task_id
        self._record_error = record_error
        self._lock = threading.Lock()

    def advance(
        self,
        amount: int = 1,
    ) -> None:
        if self._progress is None or self._task_id is None:
            return

        with self._lock:
            try:
                self._progress.advance(
                    self._task_id,
                    amount,
                )
            except (
                OSError,
                ValueError,
            ) as error:
                if self._record_error is not None:
                    self._record_error(error)

                raise ConsoleOutputError("write console output") from error


class ConsoleManager:
    def __init__(
        self,
        input_stream: TextIO | None = None,
        output_stream: TextIO | None = None,
        *,
        input_terminal: bool | None = None,
        output_terminal: bool | None = None,
    ) -> None:
        self.input = input_stream or sys.stdin
        self.output = output_stream or sys.stdout
        self.input_terminal = self._isatty(self.input) if input_terminal is None else input_terminal
        self.output_terminal = (
            self._isatty(self.output) if output_terminal is None else output_terminal
        )
        self._output_error: BaseException | None = None

        self.console = Console(
            file=self.output,
            theme=_THEME,
            force_terminal=(self.output_terminal),
            color_system=("standard" if self.output_terminal else None),
            highlight=False,
            soft_wrap=True,
        )

    @staticmethod
    def _isatty(
        stream: TextIO,
    ) -> bool:
        try:
            return stream.isatty()
        except (
            AttributeError,
            OSError,
        ):
            return False

    @property
    def output_error(
        self,
    ) -> BaseException | None:
        return self._output_error

    def _record_output_error(
        self,
        error: BaseException,
    ) -> None:
        if self._output_error is None:
            self._output_error = error

    def check_output(self) -> None:
        if self._output_error is not None:
            raise ConsoleOutputError("write console output") from self._output_error

    def _emit(
        self,
        renderable: object = "",
        *,
        end: str = "\n",
    ) -> None:
        self.check_output()

        try:
            self.console.print(
                renderable,
                end=end,
            )
        except (
            OSError,
            ValueError,
        ) as error:
            self._record_output_error(error)
            raise ConsoleOutputError("write console output") from error

    def clear(self) -> None:
        self.check_output()

        if not self.output_terminal:
            return

        try:
            self.console.clear()
        except (
            OSError,
            ValueError,
        ) as error:
            self._record_output_error(error)
            raise ConsoleOutputError("write console output") from error

    def header(self) -> None:
        self._emit(
            Panel(
                Text(
                    "NordVPN Configuration Generator",
                    style="title",
                ),
                expand=False,
                border_style="bright_cyan",
                padding=(0, 2),
            )
        )

    def prompt_secret(
        self,
        message: str,
    ) -> str:
        prompt = f"{message}: "

        if not self.input_terminal:
            self._emit(
                Text(
                    prompt,
                    style="title",
                ),
                end="",
            )
            value = self._read_line(MAX_TOKEN_READ_BYTES)
            self._emit()
            return value.strip()

        getpass_function = cast(
            Callable[..., str],
            getpass.getpass,
        )
        kwargs: dict[str, Any] = {"stream": self.output}

        if "echo_char" in inspect.signature(getpass.getpass).parameters:
            kwargs["echo_char"] = "*"

        try:
            with warnings.catch_warnings():
                warnings.simplefilter(
                    "error",
                    getpass.GetPassWarning,
                )
                value = getpass_function(
                    prompt,
                    **kwargs,
                )
        except (
            OSError,
            getpass.GetPassWarning,
        ) as error:
            raise OSError("read masked terminal input") from error

        if len(value) > MAX_TOKEN_READ_BYTES:
            raise InputTooLongError("input exceeded maximum length")

        return value.strip()

    def prompt_preferences(
        self,
        defaults: UserPreferences,
        provided: frozenset[str],
    ) -> UserPreferences:
        prompted = False

        def announce() -> None:
            nonlocal prompted

            if not prompted:
                self.info("Configuration Options (Enter for default)")
                prompted = True

        dns = defaults.dns
        if "dns" not in provided:
            announce()
            dns = self._prompt_address(
                "DNS IP",
                defaults.dns,
            )

        use_ip = defaults.use_ip
        if "use_ip" not in provided:
            announce()
            use_ip = self._prompt_bool(
                "Use IP for endpoints?",
                defaults.use_ip,
            )

        keepalive = defaults.keepalive
        if "keepalive" not in provided:
            announce()
            keepalive = self._prompt_int(
                "PersistentKeepalive",
                defaults.keepalive,
                0,
                MAX_KEEPALIVE,
            )

        exclude_dedicated = defaults.exclude_dedicated
        if "exclude_dedicated" not in provided:
            announce()
            exclude_dedicated = self._prompt_bool(
                "Exclude dedicated IP servers?",
                defaults.exclude_dedicated,
            )

        return UserPreferences(
            dns=dns.strip(),
            use_ip=use_ip,
            keepalive=keepalive,
            groups=defaults.groups,
            exclude_dedicated=(exclude_dedicated),
        )

    def _prompt_string(
        self,
        message: str,
        default: str,
    ) -> str:
        self._emit(
            Text(
                f"{message} [{default}]: ",
                style="title",
            ),
            end="",
        )

        try:
            value = self._read_line(4096)
        except (
            EOFError,
            InputTooLongError,
        ):
            return default

        normalized = value.strip()
        return normalized or default

    def _prompt_address(
        self,
        message: str,
        default: str,
    ) -> str:
        while True:
            value = self._prompt_string(
                message,
                default,
            )

            try:
                return ip_address(value.strip()).compressed
            except ValueError:
                self.fail("Enter a valid IPv4 or IPv6 address")

    def _prompt_bool(
        self,
        message: str,
        default: bool,
    ) -> bool:
        prompt_default = "Y/n" if default else "y/N"

        while True:
            self._emit(
                Text(
                    f"{message} [{prompt_default}]: ",
                    style="title",
                ),
                end="",
            )

            try:
                value = self._read_line(16).strip().lower()
            except (
                EOFError,
                InputTooLongError,
            ):
                return default

            if not value:
                return default
            if value in {"y", "yes"}:
                return True
            if value in {"n", "no"}:
                return False

            self.fail("Enter yes or no")

    def _prompt_int(
        self,
        message: str,
        default: int,
        minimum: int,
        maximum: int,
    ) -> int:
        while True:
            value = self._prompt_string(
                message,
                str(default),
            )

            try:
                parsed = int(value)
            except ValueError:
                parsed = minimum - 1

            if minimum <= parsed <= maximum:
                return parsed

            self.fail(f"Enter a value between {minimum} and {maximum}")

    def _read_line(
        self,
        limit: int,
    ) -> str:
        characters: list[str] = []

        while True:
            value = self.input.read(1)

            if value == "":
                if characters:
                    return "".join(characters).removesuffix("\r")

                raise EOFError("input ended before a value was read")

            if value == "\n":
                return "".join(characters).removesuffix("\r")

            if len(characters) >= limit:
                for _ in range(MAX_LINE_DISCARD_BYTES):
                    discarded = self.input.read(1)
                    if discarded in {
                        "",
                        "\n",
                    }:
                        break

                raise InputTooLongError("input exceeded maximum length")

            characters.append(value)

    @contextmanager
    def status(
        self,
        message: str,
    ) -> Iterator[None]:
        self.check_output()

        if not self.output_terminal:
            self._emit(message)
            yield
            return

        status = self.console.status(
            Text(
                message,
                style="info",
            ),
            spinner="dots",
        )

        try:
            status.start()
        except (
            OSError,
            ValueError,
        ) as error:
            self._record_output_error(error)
            raise ConsoleOutputError("write console output") from error

        body_failed = False

        try:
            yield
        except BaseException:
            body_failed = True
            raise
        finally:
            try:
                status.stop()
            except (
                OSError,
                ValueError,
            ) as error:
                self._record_output_error(error)

                if not body_failed:
                    raise ConsoleOutputError("write console output") from error

    @contextmanager
    def progress(
        self,
        total: int,
        message: str,
    ) -> Iterator[ProgressHandle]:
        self.check_output()

        if not self.output_terminal or total <= 0:
            yield ProgressHandle(
                None,
                None,
            )
            return

        progress = Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("{task.completed}/{task.total}"),
            console=self.console,
            transient=False,
        )

        started = False

        try:
            progress.start()
            started = True
            task_id = progress.add_task(
                message,
                total=total,
            )
        except (
            OSError,
            ValueError,
        ) as error:
            self._record_output_error(error)

            if started:
                try:
                    progress.stop()
                except (
                    OSError,
                    ValueError,
                ) as stop_error:
                    self._record_output_error(stop_error)

            raise ConsoleOutputError("write console output") from error

        body_failed = False

        try:
            yield ProgressHandle(
                progress,
                task_id,
                self._record_output_error,
            )
        except BaseException:
            body_failed = True
            raise
        finally:
            try:
                progress.stop()
            except (
                OSError,
                ValueError,
            ) as error:
                self._record_output_error(error)

                if not body_failed:
                    raise ConsoleOutputError("write console output") from error

    def success(
        self,
        message: str,
    ) -> None:
        self._emit(
            Text(
                f"✓ {message}",
                style="success",
            )
        )

    def fail(
        self,
        message: str,
    ) -> None:
        self._emit(
            Text(
                f"✗ {message}",
                style="error",
            )
        )

    def info(
        self,
        message: str,
    ) -> None:
        self._emit(
            Text(
                f"→ {message}",
                style="info",
            )
        )

    def show_key(
        self,
        key: str,
    ) -> None:
        self._emit(
            Panel(
                Text(
                    key,
                    style="success",
                ),
                title=("NordLynx Private Key"),
                border_style=("bright_green"),
                expand=False,
            )
        )

    def summary(
        self,
        output_path: str,
        stats: GenerationStats,
        duration: float,
    ) -> None:
        grid = Table.grid(padding=(0, 2))
        grid.add_column(style="bright_cyan")
        grid.add_column()
        grid.add_row(
            "Output Directory:",
            output_path,
        )
        grid.add_row(
            "Total Files Written:",
            str(stats.total + stats.best),
        )
        grid.add_row(
            " ├── Standard:",
            str(stats.total),
        )
        grid.add_row(
            " └── Optimized:",
            str(stats.best),
        )
        grid.add_row(
            "Duration:",
            f"{duration:.2f}s",
        )

        self._emit(
            Panel(
                grid,
                title="Complete",
                border_style=("bright_green"),
                expand=False,
            )
        )

    def wait(self) -> None:
        if not self.input_terminal or self._output_error is not None:
            return

        self._emit(
            Text(
                "Press Enter to exit... ",
                style="muted",
            ),
            end="",
        )

        try:
            self._read_line(4096)
        except (
            EOFError,
            InputTooLongError,
        ):
            return
