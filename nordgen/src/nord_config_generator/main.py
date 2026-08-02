import argparse
import asyncio
import os
import re
import signal
import sys
import time

from .client import NordClient
from .constants import ALIAS_TO_GROUP_ID
from .generator import Generator
from .models import UserPreferences
from .ui import ConsoleManager

_TOKEN_PATTERN = re.compile(r"[0-9a-fA-F]{64}")


def _sigint_handler(signum, frame) -> None:
    print("\n\033[91m✗ Operation cancelled by user\033[0m")
    os._exit(130)


def _build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="nordgen", description="NordVPN WireGuard Config Generator"
    )
    
    parser.add_argument("-t", "--token", help="NordVPN Access Token", default=argparse.SUPPRESS)
    parser.add_argument("-d", "--dns", help="DNS Server", default=argparse.SUPPRESS)
    parser.add_argument("-i", "--ip", action="store_true", help="Use IP Endpoint", default=argparse.SUPPRESS)
    parser.add_argument("-k", "--keepalive", type=int, help="Keepalive seconds", default=argparse.SUPPRESS)
    parser.add_argument(
        "-g",
        "--group",
        nargs="*",
        choices=sorted(ALIAS_TO_GROUP_ID.keys()),
        help="Server groups to include. Example: -g standard p2p.",
        default=argparse.SUPPRESS
    )
    parser.add_argument(
        "-e",
        "--exclude-dedicated",
        action="store_true",
        help="Exclude servers in the dedicated IP group",
        default=argparse.SUPPRESS
    )
    parser.add_argument(
        "-l",
        "--latency",
        action="store_true",
        help="Measure TCP connect latency to candidate servers and rank best_configs by RTT",
        default=argparse.SUPPRESS,
    )

    subparsers = parser.add_subparsers(dest="command", title="Commands", metavar="<command>")
    
    keyp = subparsers.add_parser("get-key", help="Retrieve NordLynx private key")
    keyp.add_argument("-t", "--token", help="NordVPN Access Token", default="")

    return parser


async def _resolve_private_key(
    ui: ConsoleManager, client: NordClient, token: str
) -> str:
    if not token:
        token = ui.prompt_secret("Please enter your NordVPN access token")
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
        
    if not token:
        ui.wait()


async def _run_generate(
    ui: ConsoleManager,
    client: NordClient,
    token: str,
    preferences: UserPreferences,
    provided_args: set[str],
) -> None:
    is_interactive = not bool(token)
    prompt_prefs = len(provided_args - {"command"}) == 0

    ui.clear()
    ui.header()
    key = await _resolve_private_key(ui, client, token)
    if not key:
        if is_interactive:
            ui.wait()
        return

    if prompt_prefs:
        ui.clear()
        ui.header()
        preferences = ui.prompt_preferences(preferences, provided_args)

    if preferences.keepalive < 0:
        ui.fail("Keepalive value must be greater than or equal to 0")
        if is_interactive:
            ui.wait()
        return

    if preferences.exclude_dedicated and preferences.groups and ALIAS_TO_GROUP_ID["dedicated"] in preferences.groups:
        ui.fail("Conflict: Cannot require 'dedicated' group while using exclude-dedicated option")
        if is_interactive:
            ui.wait()
        return

    ui.clear()
    ui.header()
    generator = Generator(client, ui)
    started_at = time.time()
    output_path = await generator.process(key, preferences)
    if output_path is not None:
        ui.clear()
        ui.header()
        ui.summary(output_path, generator.stats, time.time() - started_at)
    
    if is_interactive:
        ui.wait()


async def main() -> None:
    signal.signal(signal.SIGINT, _sigint_handler)
    
    parser = _build_argument_parser()
    
    args_list = sys.argv[1:]
    if args_list and args_list[0] == "generate":
        args_list = args_list[1:]
        
    args = parser.parse_args(args_list)
    ui = ConsoleManager()

    async with NordClient() as client:
        if hasattr(args, "command") and args.command == "get-key":
            await _run_get_key(ui, client, getattr(args, "token", ""))
        else:
            args_dict = vars(args)
            provided_args = set(args_dict.keys())
            
            token = args_dict.get("token", "")
            dns = args_dict.get("dns", "103.86.96.100")
            use_ip = args_dict.get("ip", False)
            keepalive = args_dict.get("keepalive", 25)
            exclude_dedicated = args_dict.get("exclude_dedicated", False)
            measure_latency = args_dict.get("latency", False)
            
            internal_groups = None
            if "group" in args_dict and args_dict["group"] is not None:
                internal_groups = [ALIAS_TO_GROUP_ID[g] for g in args_dict["group"]]
            
            prefs = UserPreferences(
                dns=dns,
                use_ip=use_ip,
                keepalive=keepalive,
                groups=internal_groups,
                exclude_dedicated=exclude_dedicated,
                measure_latency=measure_latency,
            )
            
            if "ip" in provided_args:
                provided_args.add("use_ip")
            if "latency" in provided_args:
                provided_args.add("measure_latency")
                
            await _run_generate(ui, client, token, prefs, provided_args)


def cli_entry_point() -> None:
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, EOFError, asyncio.CancelledError):
        print("\n\033[91m✗ Operation cancelled by user\033[0m")
        os._exit(130)


if __name__ == "__main__":
    cli_entry_point()
