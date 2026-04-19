import os
from contextlib import contextmanager
from typing import TYPE_CHECKING, Iterator

from rich.console import Console
from rich.panel import Panel
from rich.progress import BarColumn, Progress, SpinnerColumn, TextColumn
from rich.prompt import Confirm, IntPrompt, Prompt
from rich.table import Table
from rich.theme import Theme

if TYPE_CHECKING:
    from .models import GenerationStats, UserPreferences

_THEME = Theme({
    "info": "cyan",
    "success": "bold green",
    "warning": "yellow",
    "error": "bold red",
    "title": "bold magenta",
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
            border_style="cyan",
            padding=(0, 2),
        ))

    def prompt_secret(self, message: str) -> str:
        return Prompt.ask(f"[cyan]{message}[/cyan]", console=self.console, password=True).strip()

    def prompt_preferences(self, defaults: "UserPreferences") -> "UserPreferences":
        from .models import UserPreferences
        self.console.print("[info]Configuration Options (Enter for default)[/info]")
        dns = Prompt.ask("DNS IP", console=self.console, default=defaults.dns).strip()
        use_ip = Confirm.ask("Use IP for endpoints?", console=self.console, default=defaults.use_ip)
        keepalive = IntPrompt.ask(
            "PersistentKeepalive", console=self.console, default=defaults.keepalive
        )
        return UserPreferences(dns=dns, use_ip=use_ip, keepalive=keepalive)

    @contextmanager
    def status(self, message: str) -> Iterator[None]:
        with self.console.status(f"[cyan]{message}[/cyan]"):
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
            f"[green]{key}[/green]",
            title="NordLynx Private Key",
            border_style="green",
            expand=False,
        ))

    def summary(self, output_path: str, stats: "GenerationStats", duration_seconds: float) -> None:
        grid = Table.grid(padding=(0, 2))
        grid.add_column(style="cyan")
        grid.add_column()
        grid.add_row("Output Directory:", output_path)
        grid.add_row("Standard Configs:", str(stats.total))
        grid.add_row("Optimized Configs:", str(stats.best))
        grid.add_row("Incompatible:", f"[yellow]{stats.rejected}[/yellow]")
        grid.add_row("Duration:", f"{duration_seconds:.2f}s")
        self.console.print(Panel(grid, title="Complete", border_style="green", expand=False))

    def wait(self) -> None:
        self.console.print()
        Prompt.ask("[info]Press Enter to exit[/info]", console=self.console, default="")
