import argparse
import asyncio
import re
import sys
import time

from .client import NordClient
from .generator import Generator
from .models import UserPreferences
from .ui import ConsoleManager

_TOKEN_PATTERN = re.compile(r"[0-9a-f]{64}")


def _build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="nordgen", description="NordVPN WireGuard Config Generator"
    )
    subparsers = parser.add_subparsers(dest="command")

    generate_parser = subparsers.add_parser("generate", help="Generate WireGuard configurations")
    generate_parser.add_argument("-t", "--token", help="NordVPN Access Token")
    generate_parser.add_argument("-d", "--dns", default="103.86.96.100", help="DNS Server")
    generate_parser.add_argument("-i", "--ip", action="store_true", help="Use IP Endpoint")
    generate_parser.add_argument("-k", "--keepalive", type=int, default=25, help="Keepalive seconds")

    get_key_parser = subparsers.add_parser("get-key", help="Retrieve NordLynx private key")
    get_key_parser.add_argument("-t", "--token", help="NordVPN Access Token")

    return parser


async def _resolve_private_key(
    ui: ConsoleManager, client: NordClient, token: str
) -> str:
    if not token:
        token = ui.prompt_secret("Please enter your NordVPN access token: ")
    if _TOKEN_PATTERN.fullmatch(token) is None:
        ui.error("Invalid token format")
        return ""
    with ui.status("Validating token..."):
        key = await client.get_key(token)
    if not key:
        ui.fail("Token invalid")
        return ""
    ui.success("Token validated")
    return key


async def _run_get_key(ui: ConsoleManager, client: NordClient, token: str) -> None:
    ui.clear()
    ui.header()
    key = await _resolve_private_key(ui, client, token)
    if key:
        ui.show_key(key)
    ui.wait()


async def _run_generate(
    ui: ConsoleManager, client: NordClient, token: str, preferences: UserPreferences
) -> None:
    ui.clear()
    ui.header()
    key = await _resolve_private_key(ui, client, token)
    if not key:
        ui.wait()
        return

    if not token:
        ui.clear()
        ui.header()
        preferences = ui.prompt_preferences(preferences)

    ui.clear()
    ui.header()
    generator = Generator(client, ui)
    started_at = time.time()
    output_path = await generator.process(key, preferences)
    if output_path is not None:
        ui.clear()
        ui.header()
        ui.summary(output_path, generator.stats, time.time() - started_at)
    ui.wait()


async def main() -> None:
    parser = _build_argument_parser()
    arguments = parser.parse_args(sys.argv[1:] or ["generate"])
    ui = ConsoleManager()
    async with NordClient() as client:
        if arguments.command == "get-key":
            await _run_get_key(ui, client, arguments.token or "")
        else:
            preferences = UserPreferences(
                dns=arguments.dns, use_ip=arguments.ip, keepalive=arguments.keepalive
            )
            await _run_generate(ui, client, arguments.token or "", preferences)


def cli_entry_point() -> None:
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    cli_entry_point()
