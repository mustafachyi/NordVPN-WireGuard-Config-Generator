from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn
from rich.theme import Theme
from rich.table import Table
from pathlib import Path
from typing import TYPE_CHECKING, Optional
import os

if TYPE_CHECKING:
    from .main import UserPreferences, GenerationStats, ServerMetadata

class ConsoleManager:
    def __init__(self):
        custom_theme = Theme({
            "info": "cyan",
            "success": "bold green",
            "warning": "yellow",
            "error": "bold red",
            "title": "bold magenta",
            "path": "underline bright_blue"
        })
        self.console = Console(theme=custom_theme)

    def clear(self):
        os.system('cls' if os.name == 'nt' else 'clear')

    def print_title(self):
        self.console.print(Panel("[title]NordVPN Configuration Generator[/title]", expand=False, border_style="info"))

    def get_user_input(self, prompt: str, is_secret: bool = False) -> str:
        return self.console.input(f"[info]{prompt}[/info]", password=is_secret).strip()

    def get_server_type_selection(self, defaults: "UserPreferences", metadata: "ServerMetadata") -> dict:
        """Phase 1: Get connection preferences and server type selection

        Args:
            defaults: Default UserPreferences
            metadata: Server metadata with type information

        Returns:
            Dict with connection preferences and server type selection
        """
        self.console.print("\n[info]Connection Configuration[/info]")
        self.console.print("Configure your VPN connection settings:\n")

        # Connection options (DNS, endpoint, keepalive)
        dns = self.get_user_input(f"Enter DNS server IP (default: {defaults.dns} - NordVPN CyberSec): ")
        endpoint_type = self.get_user_input("Use IP instead of hostname for endpoints? (y/N): ")
        keepalive = self.get_user_input(f"Enter PersistentKeepalive value (default: {defaults.persistent_keepalive}): ")

        # Server type selection
        self.console.print("\n[info]Server Type Selection[/info]")
        self.console.print("Select the type(s) of servers you want to use:")
        self.console.print("(You can select multiple types, e.g., '3,4')\n")

        # Server type - Dynamic menu
        if metadata and metadata.server_types:
            for i, stype in enumerate(metadata.server_types, 1):
                # Show count if available
                count_info = ""
                if 'count' in stype:
                    count = stype['count']
                    if count == 0:
                        count_info = " [warning](0 servers available)[/warning]"
                    else:
                        count_info = f" [info]({count} servers)[/info]"
                self.console.print(f"  {i}. {stype['name']}{count_info}")
            server_type = self.get_user_input(f"Enter choice (1-{len(metadata.server_types)}): ")
        else:
            # Fallback to static menu
            self.console.print("  1. All servers (default)")
            self.console.print("  2. Standard servers only")
            self.console.print("  3. P2P servers only")
            self.console.print("  4. Dedicated IP servers only (requires subscription)")
            server_type = self.get_user_input("Enter choice (1-4): ")

        return {
            "dns": dns,
            "endpoint_type": endpoint_type,
            "keepalive": keepalive,
            "server_type": server_type
        }

    def get_location_preferences(self, metadata: "ServerMetadata") -> dict:
        """Phase 2: Get location filtering preferences

        Args:
            metadata: Filtered server metadata (only locations with selected types)

        Returns:
            Dict with location preferences (regions, countries, cities)
        """
        self.console.print("\n[info]Location Filtering[/info]")
        self.console.print("Select regions, countries, and cities (optional):\n")

        # Regions - Dynamic menu
        self.console.print("\nRegions (you can select multiple, e.g., '1,2'):")
        if metadata and metadata.regions:
            for i, region in enumerate(metadata.regions, 1):
                self.console.print(f"  {i}. {region['name']}")
            self.console.print("  (press Enter for all regions)")
            regions = self.get_user_input("Enter choice(s): ")
        else:
            # Fallback to static menu
            self.console.print("  1. Europe")
            self.console.print("  2. The Americas")
            self.console.print("  3. Asia Pacific")
            self.console.print("  4. Africa, Middle East & India")
            self.console.print("  (press Enter for all regions)")
            regions = self.get_user_input("Enter choice(s): ")

        # Countries - Dynamic menu (filtered by selected regions if any)
        countries = ""
        if metadata and metadata.countries:
            # Filter countries by selected regions
            filtered_countries = metadata.countries
            if regions:
                # Parse selected region IDs
                selected_region_ids = []
                if metadata.regions:
                    region_numbers = [n.strip() for n in regions.split(',') if n.strip().isdigit()]
                    for num in region_numbers:
                        idx = int(num) - 1
                        if 0 <= idx < len(metadata.regions):
                            selected_region_ids.append(metadata.regions[idx]['id'])

                # Filter countries that belong to selected regions
                if selected_region_ids:
                    filtered_countries = [
                        c for c in metadata.countries
                        if any(region_id in c.get('regions', []) for region_id in selected_region_ids)
                    ]

            self.console.print(f"\nCountries (you can select multiple, e.g., '1,5,12'):")
            self.console.print(f"  Total: {len(filtered_countries)} countries available")
            self.console.print("  Enter 'list' to see all countries, or press Enter for all")
            countries = self.get_user_input("Enter choice(s): ")

            # If user wants to see the list
            if countries.lower() == 'list':
                self.display_countries_list(filtered_countries)
                countries = self.get_user_input("Enter choice(s): ")

            # Store filtered list for later parsing
            self._filtered_countries = filtered_countries
        else:
            countries = self.get_user_input("Countries (e.g., France, Germany) or press Enter for all: ")
            self._filtered_countries = None

        # Cities - Dynamic menu (filtered by selected countries/regions)
        cities = ""
        if metadata and metadata.cities:
            # Filter cities by selected countries or regions
            filtered_cities = metadata.cities

            # If countries are selected, filter cities by those countries
            if countries:
                # Parse selected countries
                selected_countries = []
                if countries and getattr(self, '_filtered_countries', None):
                    if countries.isdigit() or ',' in countries:
                        country_numbers = [n.strip() for n in countries.split(',') if n.strip().isdigit()]
                        for num in country_numbers:
                            idx = int(num) - 1
                            if 0 <= idx < len(self._filtered_countries):
                                selected_countries.append(self._filtered_countries[idx]['name'])
                    else:
                        selected_countries = [c.strip() for c in countries.split(',') if c.strip()]

                if selected_countries:
                    filtered_cities = [
                        city for city in metadata.cities
                        if city['country'] in selected_countries
                    ]
            # Else if regions are selected, filter cities by countries in those regions
            elif regions:
                # Get countries in selected regions
                selected_region_ids = []
                if metadata.regions:
                    region_numbers = [n.strip() for n in regions.split(',') if n.strip().isdigit()]
                    for num in region_numbers:
                        idx = int(num) - 1
                        if 0 <= idx < len(metadata.regions):
                            selected_region_ids.append(metadata.regions[idx]['id'])

                if selected_region_ids and metadata.countries:
                    region_countries = [
                        c['name'] for c in metadata.countries
                        if any(region_id in c.get('regions', []) for region_id in selected_region_ids)
                    ]
                    filtered_cities = [
                        city for city in metadata.cities
                        if city['country'] in region_countries
                    ]

            self.console.print(f"\nCities (you can select multiple, e.g., '1,5,12'):")
            self.console.print(f"  Total: {len(filtered_cities)} cities available")
            self.console.print("  Enter 'list' to see all cities, or press Enter for all")
            cities = self.get_user_input("Enter choice(s): ")

            # If user wants to see the list
            if cities.lower() == 'list':
                self.display_cities_list(filtered_cities)
                cities = self.get_user_input("Enter choice(s): ")

            # Store filtered list for later parsing
            self._filtered_cities = filtered_cities
        else:
            cities = self.get_user_input("Cities (e.g., Paris, Berlin) or press Enter for all: ")
            self._filtered_cities = None

        return {
            "regions": regions,
            "countries": countries,
            "cities": cities,
            "filtered_countries": getattr(self, '_filtered_countries', None),
            "filtered_cities": getattr(self, '_filtered_cities', None)
        }

    def get_preferences(self, defaults: "UserPreferences", metadata: Optional["ServerMetadata"] = None) -> dict:
        self.console.print("\n[info]Configuration Options (press Enter to use defaults)[/info]")

        # Basic options
        dns = self.get_user_input(f"Enter DNS server IP (default: {defaults.dns} - NordVPN CyberSec): ")
        endpoint_type = self.get_user_input("Use IP instead of hostname for endpoints? (y/N): ")
        keepalive = self.get_user_input(f"Enter PersistentKeepalive value (default: {defaults.persistent_keepalive}): ")

        # Server filtering options
        self.console.print("\n[info]Server Filtering Options (optional)[/info]")

        # Server type - Dynamic menu
        self.console.print("\nServer type (you can select multiple, e.g., '4,8,9'):")
        if metadata and metadata.server_types:
            for i, stype in enumerate(metadata.server_types, 1):
                # Show count if available
                count_info = ""
                if 'count' in stype:
                    count = stype['count']
                    if count == 0:
                        count_info = " [warning](0 servers available)[/warning]"
                    else:
                        count_info = f" [info]({count} servers)[/info]"
                self.console.print(f"  {i}. {stype['name']}{count_info}")
            server_type = self.get_user_input(f"Enter choice (1-{len(metadata.server_types)}): ")
        else:
            # Fallback to static menu
            self.console.print("  1. All servers (default)")
            self.console.print("  2. Standard servers only")
            self.console.print("  3. P2P servers only")
            self.console.print("  4. Dedicated IP servers only (requires subscription)")
            server_type = self.get_user_input("Enter choice (1-4): ")

        # Regions - Dynamic menu
        self.console.print("\nRegions (you can select multiple, e.g., '1,2'):")
        if metadata and metadata.regions:
            for i, region in enumerate(metadata.regions, 1):
                self.console.print(f"  {i}. {region['name']}")
            self.console.print("  (press Enter for all regions)")
            regions = self.get_user_input("Enter choice(s): ")
        else:
            # Fallback to static menu
            self.console.print("  1. Europe")
            self.console.print("  2. The Americas")
            self.console.print("  3. Asia Pacific")
            self.console.print("  4. Africa, Middle East & India")
            self.console.print("  (press Enter for all regions)")
            regions = self.get_user_input("Enter choice(s): ")

        # Countries - Dynamic menu (filtered by selected regions if any)
        countries = ""
        if metadata and metadata.countries:
            # Filter countries by selected regions
            filtered_countries = metadata.countries
            if regions:
                # Parse selected region IDs
                selected_region_ids = []
                if metadata.regions:
                    region_numbers = [n.strip() for n in regions.split(',') if n.strip().isdigit()]
                    for num in region_numbers:
                        idx = int(num) - 1
                        if 0 <= idx < len(metadata.regions):
                            selected_region_ids.append(metadata.regions[idx]['id'])

                # Filter countries that belong to selected regions
                if selected_region_ids:
                    filtered_countries = [
                        c for c in metadata.countries
                        if any(region_id in c.get('regions', []) for region_id in selected_region_ids)
                    ]

            self.console.print(f"\nCountries (you can select multiple, e.g., '1,5,12'):")
            self.console.print(f"  Total: {len(filtered_countries)} countries available")
            self.console.print("  Enter 'list' to see all countries, or press Enter for all")
            countries = self.get_user_input("Enter choice(s): ")

            # If user wants to see the list
            if countries.lower() == 'list':
                self.display_countries_list(filtered_countries)
                countries = self.get_user_input("Enter choice(s): ")

            # Store filtered list for later parsing
            self._filtered_countries = filtered_countries
        else:
            countries = self.get_user_input("Countries (e.g., France, Germany) or press Enter for all: ")
            self._filtered_countries = None

        # Cities - Dynamic menu (filtered by selected countries/regions)
        cities = ""
        if metadata and metadata.cities:
            # Filter cities by selected countries or regions
            filtered_cities = metadata.cities

            # If countries are selected, filter cities by those countries
            if countries:
                # Parse selected countries
                selected_countries = []
                if countries and getattr(self, '_filtered_countries', None):
                    if countries.isdigit() or ',' in countries:
                        country_numbers = [n.strip() for n in countries.split(',') if n.strip().isdigit()]
                        for num in country_numbers:
                            idx = int(num) - 1
                            if 0 <= idx < len(self._filtered_countries):
                                selected_countries.append(self._filtered_countries[idx]['name'])
                    else:
                        selected_countries = [c.strip() for c in countries.split(',') if c.strip()]

                if selected_countries:
                    filtered_cities = [
                        city for city in metadata.cities
                        if city['country'] in selected_countries
                    ]
            # Else if regions are selected, filter cities by countries in those regions
            elif regions:
                # Get countries in selected regions
                selected_region_ids = []
                if metadata.regions:
                    region_numbers = [n.strip() for n in regions.split(',') if n.strip().isdigit()]
                    for num in region_numbers:
                        idx = int(num) - 1
                        if 0 <= idx < len(metadata.regions):
                            selected_region_ids.append(metadata.regions[idx]['id'])

                if selected_region_ids and metadata.countries:
                    region_countries = [
                        c['name'] for c in metadata.countries
                        if any(region_id in c.get('regions', []) for region_id in selected_region_ids)
                    ]
                    filtered_cities = [
                        city for city in metadata.cities
                        if city['country'] in region_countries
                    ]

            self.console.print(f"\nCities (you can select multiple, e.g., '1,5,12'):")
            self.console.print(f"  Total: {len(filtered_cities)} cities available")
            self.console.print("  Enter 'list' to see all cities, or press Enter for all")
            cities = self.get_user_input("Enter choice(s): ")

            # If user wants to see the list
            if cities.lower() == 'list':
                self.display_cities_list(filtered_cities)
                cities = self.get_user_input("Enter choice(s): ")

            # Store filtered list for later parsing
            self._filtered_cities = filtered_cities
        else:
            cities = self.get_user_input("Cities (e.g., Paris, Berlin) or press Enter for all: ")
            self._filtered_cities = None

        return {
            "dns": dns,
            "endpoint_type": endpoint_type,
            "keepalive": keepalive,
            "server_type": server_type,
            "regions": regions,
            "countries": countries,
            "cities": cities,
            "metadata": metadata,  # Pass metadata for parsing
            "filtered_countries": getattr(self, '_filtered_countries', None),  # Pass filtered countries list
            "filtered_cities": getattr(self, '_filtered_cities', None)  # Pass filtered cities list
        }

    def display_countries_list(self, countries: list):
        """Display paginated list of countries"""
        self.console.print("\n[info]Available Countries:[/info]")
        col_width = 40  # Total width per column
        for i, country in enumerate(countries, 1):
            code = country.get('code', '')
            name = country.get('name', '')
            # Format: "  num. name (code)" padded to col_width
            entry = f"  {i:3d}. {name} ({code})"
            # Truncate if too long, pad if too short
            if len(entry) > col_width:
                entry = entry[:col_width-3] + "..."
            self.console.print(f"{entry:<{col_width}}", end="")
            if i % 3 == 0:
                print()
        if len(countries) % 3 != 0:
            print()
        self.console.print()

    def display_cities_list(self, cities: list):
        """Display paginated list of cities"""
        self.console.print("\n[info]Available Cities:[/info]")
        col_width = 40  # Total width per column
        for i, city in enumerate(cities, 1):
            city_name = city.get('name', '')
            country_name = city.get('country', '')
            # Format: "  num. city (country)" padded to col_width
            entry = f"  {i:3d}. {city_name} ({country_name})"
            # Truncate if too long, pad if too short
            if len(entry) > col_width:
                entry = entry[:col_width-3] + "..."
            self.console.print(f"{entry:<{col_width}}", end="")
            if i % 3 == 0:
                print()
        if len(cities) % 3 != 0:
            print()
        self.console.print()

    def print_message(self, style: str, message: str):
        self.console.print(f"[{style}]{message}[/{style}]")

    def create_progress_bar(self, transient: bool = True) -> Progress:
        return Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
            console=self.console,
            transient=transient
        )

    def display_key(self, key: str):
        key_panel = Panel(key, title="NordLynx Private Key", border_style="success", expand=False)
        self.console.print(key_panel)

    def display_summary(self, output_dir: Path, stats: "GenerationStats", elapsed_time: float):
        summary_table = Table.grid(padding=(0, 2))
        summary_table.add_column(style="info")
        summary_table.add_column()
        summary_table.add_row("Output Directory:", f"[path]{output_dir}[/path]")
        summary_table.add_row("Standard Configs:", f"{stats.total_configs}")
        summary_table.add_row("Optimized Configs:", f"{stats.best_configs}")
        summary_table.add_row("Time Taken:", f"{elapsed_time:.2f} seconds")

        self.console.print(Panel(
            summary_table,
            title="[success]Generation Complete[/success]",
            border_style="success",
            expand=False
        ))