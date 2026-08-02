import argparse
import asyncio
import re
import signal
import sys
import time
from collections.abc import Callable, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Never, Protocol, TextIO

from .client import NordClient, NordClientError, UnauthorizedError
from .constants import ALIAS_TO_GROUP_ID, GROUP_DEDICATED_ID
from .generator import GenerationError, Generator
from .models import Coordinates, UserPreferences
from .ui import ConsoleManager, ConsoleOutputError, InputTooLongError
from .wireguard import WireGuardValueError, validate_key

DEFAULT_DNS = "103.86.96.100"
_TOKEN_PATTERN = re.compile(r"[0-9a-fA-F]{64}\Z")

_HELP = """USAGE:
  nordgen [options]
  nordgen generate [options]
  nordgen get-key [options]

COMMANDS:
  generate    Generate WireGuard configurations (default)
  get-key     Extract the NordLynx private key from a token
  help        Show this help message

GENERATE OPTIONS:
  -t, --token              NordVPN access token (prompts if omitted)
  -d, --dns                DNS server IP (default: 103.86.96.100)
  -i, --ip                 Use IP addresses instead of hostnames for endpoints
  -k, --keepalive          PersistentKeepalive in seconds, 0-65535 (default: 25)
  -e, --exclude-dedicated  Exclude servers in the dedicated IP group
  -g, --group              Server groups to include; repeat or use a space-separated list
                           Valid groups: standard, p2p, dedicated, onion, double

GET-KEY OPTIONS:
  -t, --token              NordVPN access token

EXAMPLES:
  nordgen -t <your-token>
  nordgen -d 1.1.1.1 -k 15 -g standard p2p
  nordgen get-key -t <your-token>

"""


class NordAPI(Protocol):
    async def get_key(self, token: str) -> str: ...

    async def get_geo(self) -> Coordinates: ...

    async def get_servers(self) -> list[object]: ...


ClientFactory = Callable[[], AbstractAsyncContextManager[NordAPI]]


class UsageError(ValueError):
    pass


class QuietArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> Never:
        raise UsageError(message)


@dataclass(slots=True, frozen=True)
class GenerateOptions:
    token: str
    preferences: UserPreferences
    provided: frozenset[str]


def contains_help(args: Sequence[str]) -> bool:
    return any(argument in {"-h", "--help"} for argument in args)


def resolve_command(args: Sequence[str]) -> tuple[str, list[str]]:
    if not args:
        return "generate", []
    first = args[0]
    if first == "help":
        if len(args) != 1:
            raise UsageError("help does not accept arguments")
        return "help", []
    if first in {"get-key", "generate"}:
        return first, list(args[1:])
    if first.startswith("-"):
        return "generate", list(args)
    raise UsageError(f"unknown command: {first}")


def parse_generate_options(args: Sequence[str]) -> GenerateOptions:
    parser = QuietArgumentParser(add_help=False, allow_abbrev=False)
    parser.add_argument("-t", "--token", default=argparse.SUPPRESS)
    parser.add_argument("-d", "--dns", default=argparse.SUPPRESS)
    parser.add_argument("-i", "--ip", action="store_true", default=argparse.SUPPRESS)
    parser.add_argument("-k", "--keepalive", type=int, default=argparse.SUPPRESS)
    parser.add_argument(
        "-e",
        "--exclude-dedicated",
        action="store_true",
        default=argparse.SUPPRESS,
    )
    parser.add_argument(
        "-g",
        "--group",
        action="append",
        nargs="+",
        default=argparse.SUPPRESS,
    )
    namespace = parser.parse_args(args)
    values = vars(namespace)
    provided = frozenset(
        {"token" if name == "token" else "use_ip" if name == "ip" else name for name in values}
    )

    groups: list[str] = []
    seen_groups: set[str] = set()
    for group_set in values.get("group", []):
        for raw_alias in group_set:
            alias = raw_alias.strip().lower()
            identifier = ALIAS_TO_GROUP_ID.get(alias)
            if identifier is None:
                raise UsageError(f'unknown server group "{raw_alias}"')
            if identifier in seen_groups:
                continue
            seen_groups.add(identifier)
            groups.append(identifier)

    preferences = UserPreferences(
        dns=str(values.get("dns", DEFAULT_DNS)).strip(),
        use_ip=bool(values.get("ip", False)),
        keepalive=int(values.get("keepalive", 25)),
        groups=tuple(groups),
        exclude_dedicated=bool(values.get("exclude_dedicated", False)),
    )
    if preferences.exclude_dedicated and GROUP_DEDICATED_ID in preferences.groups:
        raise UsageError("cannot require the dedicated group while excluding dedicated servers")
    if provided:
        try:
            preferences.validate()
        except ValueError as error:
            raise UsageError(str(error)) from error
    return GenerateOptions(str(values.get("token", "")), preferences, provided)


def parse_get_key_options(args: Sequence[str]) -> str:
    parser = QuietArgumentParser(add_help=False, allow_abbrev=False)
    parser.add_argument("-t", "--token", default="")
    namespace = parser.parse_args(args)
    return str(namespace.token)


def validate_token(value: str) -> str:
    token = value.strip()
    if _TOKEN_PATTERN.fullmatch(token) is None:
        raise ValueError("token must contain exactly 64 hexadecimal characters")
    return token


async def resolve_private_key(
    ui: ConsoleManager,
    client: NordAPI,
    token: str,
) -> str:
    if not token.strip():
        token = ui.prompt_secret("NordVPN access token")
    normalized_token = validate_token(token)
    with ui.status("Validating token..."):
        try:
            key = await client.get_key(normalized_token)
        except UnauthorizedError as error:
            raise RuntimeError("token was rejected by NordVPN") from error
        except NordClientError as error:
            raise RuntimeError(f"retrieve NordLynx private key: {error}") from error
    try:
        validate_key(key)
    except WireGuardValueError as error:
        raise RuntimeError(f"NordVPN returned an invalid private key: {error}") from error
    ui.success("Token validated")
    return key


async def run_get_key(
    ui: ConsoleManager,
    client: NordAPI,
    token: str,
) -> int:
    interactive = not token.strip()
    ui.header()
    try:
        key = await resolve_private_key(ui, client, token)
    except (ValueError, RuntimeError, EOFError, InputTooLongError) as error:
        return _handle_runtime_error(ui, error, interactive)
    ui.show_key(key)
    if interactive:
        ui.wait()
    return 0


async def run_generate(
    ui: ConsoleManager,
    client: NordAPI,
    options: GenerateOptions,
) -> int:
    interactive = not options.token.strip()
    prompt_preferences = not options.provided
    ui.header()
    try:
        key = await resolve_private_key(ui, client, options.token)
        preferences = options.preferences
        if prompt_preferences:
            ui.clear()
            preferences = ui.prompt_preferences(preferences, options.provided)
            ui.clear()
        preferences.validate()
        if preferences.exclude_dedicated and GROUP_DEDICATED_ID in preferences.groups:
            raise ValueError("cannot require the dedicated group while excluding dedicated servers")

        generator = Generator(client, ui)
        started_at = time.monotonic()
        output_path = await generator.process(key, preferences)
        ui.clear()
        ui.summary(str(output_path), generator.stats, time.monotonic() - started_at)
    except asyncio.CancelledError:
        return _handle_runtime_error(ui, asyncio.CancelledError(), False)
    except (ValueError, RuntimeError, OSError, EOFError, InputTooLongError) as error:
        return _handle_runtime_error(ui, error, interactive)
    if interactive:
        ui.wait()
    return 0


def _handle_runtime_error(ui: ConsoleManager, error: BaseException, wait: bool) -> int:
    cancelled = isinstance(error, (asyncio.CancelledError, KeyboardInterrupt))
    try:
        ui.fail("Operation cancelled" if cancelled else str(error))
        if wait:
            ui.wait()
    except ConsoleOutputError:
        return 1
    return 130 if cancelled else 1


async def run(
    args: Sequence[str],
    input_stream: TextIO,
    output_stream: TextIO,
    *,
    client_factory: ClientFactory = NordClient,
) -> int:
    ui = ConsoleManager(input_stream, output_stream)
    try:
        if contains_help(args):
            output_stream.write(_HELP)
            output_stream.flush()
            return 0
        try:
            command, command_args = resolve_command(args)
        except UsageError as error:
            ui.fail(str(error))
            output_stream.write(_HELP)
            output_stream.flush()
            return 2
        if command == "help":
            output_stream.write(_HELP)
            output_stream.flush()
            return 0

        try:
            if command == "get-key":
                parsed: GenerateOptions | str = parse_get_key_options(command_args)
            else:
                parsed = parse_generate_options(command_args)
        except UsageError as error:
            ui.fail(str(error))
            return 2

        async with client_factory() as client:
            if command == "get-key":
                return await run_get_key(ui, client, str(parsed))
            if not isinstance(parsed, GenerateOptions):
                raise TypeError("generate options were not parsed")
            return await run_generate(ui, client, parsed)
    except asyncio.CancelledError:
        return _handle_runtime_error(ui, asyncio.CancelledError(), False)
    except ConsoleOutputError:
        return 1
    except (OSError, NordClientError, GenerationError) as error:
        return _handle_runtime_error(ui, error, False)


def cli_entry_point() -> None:
    previous_sigterm = signal.getsignal(signal.SIGTERM)

    def terminate(signum: int, frame: object) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, terminate)
    try:
        try:
            exit_code = asyncio.run(run(sys.argv[1:], sys.stdin, sys.stdout))
        except KeyboardInterrupt:
            ui = ConsoleManager(sys.stdin, sys.stdout)
            exit_code = _handle_runtime_error(ui, KeyboardInterrupt(), False)
    finally:
        signal.signal(signal.SIGTERM, previous_sigterm)
    raise SystemExit(exit_code)


if __name__ == "__main__":
    cli_entry_point()
