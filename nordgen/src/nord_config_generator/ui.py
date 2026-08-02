import os
import sys
from contextlib import contextmanager
from typing import Iterator

from rich.console import Console
from rich.panel import Panel
from rich.progress import BarColumn, Progress, SpinnerColumn, TextColumn
from rich.prompt import Confirm, IntPrompt, Prompt
from rich.table import Table
from rich.theme import Theme

from .models import GenerationStats, UserPreferences

_THEME = Theme({
    "info": "bright_cyan",
    "success": "bold bright_green",
    "warning": "bright_yellow",
    "error": "bold bright_red",
    "title": "bold bright_white",
})


class ConsoleManager:
    def __init__(self) -> None:
        self.console = Console(theme=_THEME)

    def clear(self) -> None:
        self.console.clear()

    def header(self) -> None:
        self.console.print(Panel(
            "[title]NordVPN Configuration Generator[/title]",
            expand=False,
            border_style="bright_cyan",
            padding=(0, 2),
        ))

    def prompt_secret(self, message: str) -> str:
        sys.stdout.write(f"\033[96m{message}:\033[0m ")
        sys.stdout.flush()
        
        if not sys.stdin.isatty():
            line = sys.stdin.readline()
            if not line:
                return ""
            sys.stdout.write("\n")
            sys.stdout.flush()
            return line.strip()

        password_chars = []

        if os.name == "nt":
            import msvcrt
            while True:
                char = msvcrt.getch()
                if char in (b"\r", b"\n"):
                    sys.stdout.write("\n")
                    sys.stdout.flush()
                    return "".join(password_chars).strip()
                elif char == b"\x03":
                    sys.stdout.write("\n\033[91m✗ Operation cancelled by user\033[0m\n")
                    sys.stdout.flush()
                    os._exit(130)
                elif char == b"\x08":
                    if password_chars:
                        password_chars.pop()
                        sys.stdout.write("\b \b")
                        sys.stdout.flush()
                else:
                    try:
                        c = char.decode("utf-8")
                        if c.isprintable():
                            password_chars.append(c)
                            sys.stdout.write("*")
                            sys.stdout.flush()
                    except UnicodeDecodeError:
                        pass
        else:
            import tty
            import termios
            fd = sys.stdin.fileno()
            old_settings = termios.tcgetattr(fd)
            try:
                tty.setraw(fd)
                while True:
                    char = sys.stdin.read(1)
                    if char in ("\r", "\n"):
                        sys.stdout.write("\r\n")
                        sys.stdout.flush()
                        break
                    elif char == "\x03":
                        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)
                        sys.stdout.write("\r\n\033[91m✗ Operation cancelled by user\033[0m\r\n")
                        sys.stdout.flush()
                        os._exit(130)
                    elif char in ("\x08", "\x7f"):
                        if password_chars:
                            password_chars.pop()
                            sys.stdout.write("\b \b")
                            sys.stdout.flush()
                    elif not char or char == "\x04":
                        sys.stdout.write("\r\n")
                        sys.stdout.flush()
                        break
                    elif char.isprintable():
                        password_chars.append(char)
                        sys.stdout.write("*")
                        sys.stdout.flush()
            finally:
                termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)
            
            return "".join(password_chars).strip()

    def prompt_preferences(self, defaults: UserPreferences, provided: set[str]) -> UserPreferences:
        prompted_any = False

        dns = defaults.dns
        if "dns" not in provided:
            if not prompted_any:
                self.console.print("[info]Configuration Options (Enter for default)[/info]")
                prompted_any = True
            dns = Prompt.ask("DNS IP", console=self.console, default=defaults.dns).strip()

        use_ip = defaults.use_ip
        if "use_ip" not in provided:
            if not prompted_any:
                self.console.print("[info]Configuration Options (Enter for default)[/info]")
                prompted_any = True
            use_ip = Confirm.ask("Use IP for endpoints?", console=self.console, default=defaults.use_ip)

        keepalive = defaults.keepalive
        if "keepalive" not in provided:
            if not prompted_any:
                self.console.print("[info]Configuration Options (Enter for default)[/info]")
                prompted_any = True
            keepalive = IntPrompt.ask(
                "PersistentKeepalive", console=self.console, default=defaults.keepalive
            )

        exclude_dedicated = defaults.exclude_dedicated
        if "exclude_dedicated" not in provided:
            if not prompted_any:
                self.console.print("[info]Configuration Options (Enter for default)[/info]")
                prompted_any = True
            exclude_dedicated = Confirm.ask(
                "Exclude dedicated IP servers?", console=self.console, default=defaults.exclude_dedicated
            )

        measure_latency = defaults.measure_latency
        if "measure_latency" not in provided:
            if not prompted_any:
                self.console.print("[info]Configuration Options (Enter for default)[/info]")
                prompted_any = True
            measure_latency = Confirm.ask(
                "Measure server latency (TCP probe) to refine best_configs?",
                console=self.console,
                default=defaults.measure_latency,
            )

        return UserPreferences(
            dns=dns,
            use_ip=use_ip,
            keepalive=keepalive,
            groups=defaults.groups,
            exclude_dedicated=exclude_dedicated,
            measure_latency=measure_latency,
        )

    @contextmanager
    def status(self, message: str) -> Iterator[None]:
        with self.console.status(f"[bright_cyan]{message}[/bright_cyan]"):
            yield

    @contextmanager
    def progress(self) -> Iterator[Progress]:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("{task.completed}/{task.total}"),
            console=self.console,
            transient=False,
        ) as progress_instance:
            yield progress_instance

    def success(self, message: str) -> None:
        self.console.print(f"[success]{message}[/success]")

    def fail(self, message: str) -> None:
        self.console.print(f"[error]{message}[/error]")

    def error(self, message: str) -> None:
        self.console.print(f"[error]{message}[/error]")

    def show_key(self, key: str) -> None:
        self.console.print(Panel(
            f"[bright_green]{key}[/bright_green]",
            title="NordLynx Private Key",
            border_style="bright_green",
            expand=False,
        ))

    def summary(self, output_path: str, stats: GenerationStats, duration_seconds: float) -> None:
        grid = Table.grid(padding=(0, 2))
        grid.add_column(style="bright_cyan")
        grid.add_column()
        grid.add_row("Output Directory:", output_path)
        grid.add_row("Total Files Written:", str(stats.total + stats.best))
        grid.add_row(" ├── Standard:", str(stats.total))
        grid.add_row(" └── Optimized:", str(stats.best))
        grid.add_row("Duration:", f"{duration_seconds:.2f}s")
        self.console.print(Panel(grid, title="Complete", border_style="bright_green", expand=False))

    def wait(self) -> None:
        if not sys.stdin.isatty():
            return
        self.console.print()
        try:
            self.console.input("[info]Press Enter to exit... [/info]")
        except (KeyboardInterrupt, EOFError):
            pass
