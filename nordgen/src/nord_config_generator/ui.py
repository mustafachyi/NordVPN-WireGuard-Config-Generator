import os
from typing import TYPE_CHECKING
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TaskID
from rich.theme import Theme
from rich.table import Table

if TYPE_CHECKING:
    from .models import UserPreferences, Stats

class ConsoleManager:
    def __init__(self):
        theme = Theme({
            "info": "cyan",
            "success": "bold green",
            "warning": "yellow",
            "error": "bold red",
            "title": "bold magenta",
        })
        self.console = Console(theme=theme)
        self.progress = None
        self.task_ids = {}

    def clear(self):
        os.system('cls' if os.name == 'nt' else 'clear')

    def header(self):
        self.console.print(Panel(
            "[title]NordVPN Configuration Generator[/title]", 
            expand=False, 
            border_style="cyan",
            padding=(0, 2)
        ))

    def prompt_secret(self, msg: str) -> str:
        return self.console.input(f"[cyan]{msg}[/cyan]", password=True).strip()

    def prompt_prefs(self, defaults: "UserPreferences") -> "UserPreferences":
        from .models import UserPreferences
        self.console.print("[info]Configuration Options (Enter for default)[/info]")
        
        d_in = self.console.input(f"DNS IP (default: {defaults.dns}): ").strip()
        dns = d_in if d_in else defaults.dns
        
        i_in = self.console.input("Use IP for endpoints? (y/N): ").strip().lower()
        use_ip = i_in == 'y'
        
        k_in = self.console.input(f"PersistentKeepalive (default: {defaults.keepalive}): ").strip()
        ka = int(k_in) if k_in.isdigit() else defaults.keepalive
        
        return UserPreferences(dns, use_ip, ka)

    def spin(self, msg: str):
        with self.console.status(f"[cyan]{msg}"):
            pass

    def success(self, msg: str):
        self.console.print(f"[success]{msg}[/success]")

    def fail(self, msg: str):
        self.console.print(f"[error]{msg}[/error]")

    def error(self, msg: str):
        self.console.print(f"[error]{msg}[/error]")

    def show_key(self, key: str):
        self.console.print(Panel(
            f"[green]{key}[/green]", 
            title="NordLynx Private Key", 
            border_style="green",
            expand=False
        ))

    def summary(self, path: str, stats: "Stats", sec: float):
        grid = Table.grid(padding=(0, 2))
        grid.add_column(style="cyan")
        grid.add_column()
        grid.add_row("Output Directory:", path)
        grid.add_row("Standard Configs:", str(stats.total))
        grid.add_row("Optimized Configs:", str(stats.best))
        grid.add_row("Incompatible:", f"[yellow]{stats.rejected}[/yellow]")
        grid.add_row("Duration:", f"{sec:.2f}s")
        
        self.console.print(Panel(
            grid, 
            title="Complete", 
            border_style="green", 
            expand=False
        ))

    def start_progress(self):
        self.progress = Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("{task.completed}/{task.total}"),
            console=self.console,
            transient=False
        )
        self.progress.start()

    def add_task(self, name: str, total: int) -> TaskID:
        if self.progress:
            return self.progress.add_task(name, total=total)
        return TaskID(0)

    def update_progress(self, task_id: TaskID):
        if self.progress:
            self.progress.update(task_id, advance=1)

    def stop_progress(self):
        if self.progress:
            self.progress.stop()

    def wait(self):
        self.console.print()
        self.console.input("[info]Press Enter to exit...[/info]")