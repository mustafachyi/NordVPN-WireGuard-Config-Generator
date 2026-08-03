from __future__ import annotations

import argparse
import base64
import binascii
import ipaddress
import json
import os
import re
import secrets
import stat
import subprocess
import sys
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from pathlib import Path

TOKEN_PATTERN = re.compile(r"[0-9A-Fa-f]{64}\Z")
WIREGUARD_KEY_PATTERN = re.compile(r"(?<![A-Za-z0-9+/])([A-Za-z0-9+/]{43}=)(?![A-Za-z0-9+/=])")
OUTPUT_NAME_PATTERN = re.compile(r"nordvpn_configs_\d{8}_\d{6}_\d{9}\Z")
SUMMARY_PATTERNS = {
    "total": re.compile(r"Total Files Written:\s*(\d+)"),
    "configs": re.compile(r"Standard:\s*(\d+)"),
    "best": re.compile(r"Optimized:\s*(\d+)"),
}
EXPECTED_GENERATION_MESSAGES = (
    "Token validated",
    "Fetched server data",
    "Dataset processed",
    "File system prepared",
    "Configuration files written",
    "Complete",
    "Output Directory:",
)
EXPECTED_OUTPUT_TREES = frozenset({"configs", "best_configs"})
DNS_ADDRESS = "2606:4700:4700::1111"
KEEPALIVE = 0
REQUIRED_GROUP = "standard"
FORBIDDEN_GROUP = "dedicated"
COMMAND_TIMEOUT_SECONDS = 300
MAX_DIAGNOSTIC_LINES = 200
MAX_DIAGNOSTIC_CHARACTERS = 16_000
DOCKER_ACCEPTANCE_LABEL_KEY = "nordgen.live-acceptance"


class VerificationError(RuntimeError):
    pass


class CommandFailure(VerificationError):
    def __init__(
        self,
        label: str,
        stdout: str,
        stderr: str,
        detail: str,
    ) -> None:
        super().__init__(detail)
        self.label = label
        self.stdout = stdout
        self.stderr = stderr


@dataclass(frozen=True, slots=True)
class CommandResult:
    stdout: str
    stderr: str
    returncode: int


@dataclass(frozen=True, slots=True)
class TreeSummary:
    configs: int
    best: int
    used_location_fallback: bool


@dataclass(frozen=True, slots=True)
class ImplementationSummary:
    label: str
    private_key: str
    tree: TreeSummary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python-command", required=True, type=Path)
    parser.add_argument("--go-command", required=True, type=Path)
    parser.add_argument("--docker-image", required=True)
    parser.add_argument("--work-root", required=True, type=Path)
    return parser.parse_args()


def token_secret_values(token: str) -> frozenset[str]:
    values: set[str] = set()

    for token_variant in {token, token.lower(), token.upper()}:
        credential = f"token:{token_variant}"
        encoded_credential = base64.b64encode(credential.encode("ascii")).decode("ascii")
        values.add(token_variant)
        values.add(encoded_credential)

    return frozenset(values)


def wireguard_secret_values(value: str) -> frozenset[str]:
    return frozenset({value, value.removesuffix("=")})


def mask_value(value: str) -> None:
    if value and os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::add-mask::{value}", flush=True)


def mask_values(values: Collection[str]) -> None:
    for value in sorted(values, key=len, reverse=True):
        mask_value(value)


def child_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment.pop("NORDVPN_ACCESS_TOKEN", None)
    environment["NO_COLOR"] = "1"
    environment["PYTHONUTF8"] = "1"
    environment["PYTHONUNBUFFERED"] = "1"
    environment["TERM"] = "dumb"
    return environment


def normalize_captured(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def run_command(
    label: str,
    command: Sequence[str],
    *,
    cwd: Path | None = None,
    input_text: str = "",
    expected_returncode: int = 0,
    timeout_seconds: int = COMMAND_TIMEOUT_SECONDS,
) -> CommandResult:
    try:
        completed = subprocess.run(
            list(command),
            cwd=os.fspath(cwd) if cwd is not None else None,
            env=child_environment(),
            input=input_text,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except FileNotFoundError as error:
        raise VerificationError(f"{label}: executable was not found: {command[0]}") from error
    except subprocess.TimeoutExpired as error:
        raise CommandFailure(
            label,
            normalize_captured(error.stdout),
            normalize_captured(error.stderr),
            f"{label} exceeded {timeout_seconds} seconds",
        ) from error
    except OSError as error:
        raise VerificationError(f"{label}: could not start command: {error}") from error

    result = CommandResult(
        completed.stdout,
        completed.stderr,
        completed.returncode,
    )
    if result.returncode != expected_returncode:
        raise CommandFailure(
            label,
            result.stdout,
            result.stderr,
            f"{label} exited with {result.returncode}; expected {expected_returncode}",
        )
    return result


def combined_output(result: CommandResult) -> str:
    return f"{result.stdout}\n{result.stderr}"


def require_text(
    result: CommandResult,
    expected: str,
    label: str,
) -> None:
    if expected.lower() not in combined_output(result).lower():
        raise VerificationError(f"{label} output did not contain {expected!r}")


def require_secrets_absent(
    result: CommandResult,
    secret_values: Collection[str],
    label: str,
) -> None:
    output = combined_output(result)
    if any(value and value in output for value in secret_values):
        raise VerificationError(f"{label} exposed a protected credential value")


def validate_packaged_contract(
    label: str,
    command_prefix: Sequence[str],
    token_secret_values_set: Collection[str],
) -> None:
    help_command = run_command(
        f"{label} help command",
        [*command_prefix, "help"],
    )
    require_text(
        help_command,
        "USAGE:",
        f"{label} help command",
    )
    require_text(
        help_command,
        "get-key",
        f"{label} help command",
    )

    help_flag = run_command(
        f"{label} help flag",
        [*command_prefix, "--help"],
    )
    require_text(
        help_flag,
        "USAGE:",
        f"{label} help flag",
    )

    unknown = run_command(
        f"{label} unknown command",
        [*command_prefix, "unknown"],
        expected_returncode=2,
    )
    require_text(
        unknown,
        "unknown command",
        f"{label} unknown command",
    )

    unknown_option = run_command(
        f"{label} unknown option",
        [*command_prefix, "generate", "--unknown"],
        expected_returncode=2,
    )
    require_text(
        unknown_option,
        "unknown",
        f"{label} unknown option",
    )

    implicit_generate = run_command(
        f"{label} implicit generate validation",
        [*command_prefix, "--dns", "invalid"],
        expected_returncode=2,
    )
    require_text(
        implicit_generate,
        "DNS",
        f"{label} implicit generate validation",
    )

    invalid_token = run_command(
        f"{label} invalid token",
        [
            *command_prefix,
            "get-key",
            "--token",
            "invalid",
        ],
        expected_returncode=1,
    )
    require_text(
        invalid_token,
        "64 hexadecimal",
        f"{label} invalid token",
    )

    conflict = run_command(
        f"{label} group conflict",
        [
            *command_prefix,
            "generate",
            "--group",
            "dedicated",
            "--exclude-dedicated",
        ],
        expected_returncode=2,
    )
    require_text(
        conflict,
        "dedicated",
        f"{label} group conflict",
    )

    for result_name, result in (
        ("help command", help_command),
        ("help flag", help_flag),
        ("unknown command", unknown),
        ("unknown option", unknown_option),
        ("implicit generate validation", implicit_generate),
        ("invalid token", invalid_token),
        ("group conflict", conflict),
    ):
        require_secrets_absent(
            result,
            token_secret_values_set,
            f"{label} {result_name}",
        )


def validate_wireguard_key(
    value: str,
    label: str,
) -> None:
    try:
        decoded = base64.b64decode(
            value,
            validate=True,
        )
    except (binascii.Error, ValueError) as error:
        raise VerificationError(f"{label} is not valid Base64") from error

    if len(decoded) != 32:
        raise VerificationError(f"{label} does not decode to 32 bytes")


def extract_private_key(
    result: CommandResult,
    label: str,
) -> str:
    matches = set(WIREGUARD_KEY_PATTERN.findall(combined_output(result)))
    if len(matches) != 1:
        raise VerificationError(
            f"{label} contained {len(matches)} distinct WireGuard keys; expected one"
        )

    private_key = next(iter(matches))
    validate_wireguard_key(
        private_key,
        f"{label} private key",
    )
    if not isinstance(private_key, str):
        raise VerificationError("private_key must be a string")
    return private_key


def generation_arguments() -> list[str]:
    return [
        "generate",
        "--dns",
        DNS_ADDRESS,
        "--ip",
        "--keepalive",
        str(KEEPALIVE),
        "--group",
        REQUIRED_GROUP,
        "--exclude-dedicated",
    ]


def prepare_empty_directory(path: Path) -> None:
    if path.exists():
        if not path.is_dir():
            raise VerificationError(f"acceptance path is not a directory: {path}")
        if any(path.iterdir()):
            raise VerificationError(f"acceptance path is not empty: {path}")
    else:
        path.mkdir(
            parents=True,
            mode=0o700,
        )

    path.chmod(0o700)


def run_native_implementation(
    label: str,
    executable: Path,
    root: Path,
    token: str,
    token_secret_values_set: Collection[str],
    known_secrets: set[str],
) -> ImplementationSummary:
    if not executable.is_file():
        raise VerificationError(f"{label} executable does not exist: {executable}")

    command_prefix = [os.fspath(executable)]
    validate_packaged_contract(
        label,
        command_prefix,
        token_secret_values_set,
    )

    prepare_empty_directory(root)

    key_result = run_command(
        f"{label} live get-key",
        [*command_prefix, "get-key"],
        cwd=root,
        input_text=f"{token}\n",
    )
    require_secrets_absent(
        key_result,
        token_secret_values_set,
        f"{label} live get-key",
    )
    require_text(
        key_result,
        "Token validated",
        f"{label} live get-key",
    )

    scan_tree_for_secrets(
        root,
        token_secret_values_set,
    )
    prepare_empty_directory(root)

    private_key = extract_private_key(
        key_result,
        f"{label} live get-key",
    )
    private_key_secrets = wireguard_secret_values(private_key)
    known_secrets.update(private_key_secrets)
    mask_values(private_key_secrets)

    generate_result = run_command(
        f"{label} live generation",
        [
            *command_prefix,
            *generation_arguments(),
        ],
        cwd=root,
        input_text=f"{token}\n",
    )
    require_secrets_absent(
        generate_result,
        known_secrets,
        f"{label} live generation",
    )

    tree = validate_generation(
        root,
        generate_result,
        private_key,
        token_secret_values_set,
        label,
    )
    return ImplementationSummary(
        label,
        private_key,
        tree,
    )


def inspect_docker_image(image: str) -> None:
    result = run_command(
        "Docker image metadata inspection",
        [
            "docker",
            "image",
            "inspect",
            "--format",
            "{{json .Config}}",
            image,
        ],
    )

    try:
        config = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise VerificationError("Docker image metadata was not valid JSON") from error

    expected = {
        "User": "65532:65532",
        "WorkingDir": "/data",
        "Entrypoint": ["/usr/local/bin/nordgen"],
    }
    for key, value in expected.items():
        if config.get(key) != value:
            raise VerificationError(
                f"Docker image {key} was {config.get(key)!r}; expected {value!r}"
            )


def remove_container(
    container_name: str,
) -> CommandResult:
    try:
        completed = subprocess.run(
            [
                "docker",
                "container",
                "rm",
                "--force",
                container_name,
            ],
            env=child_environment(),
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise VerificationError(
            f"could not remove Docker acceptance container {container_name}: {error}"
        ) from error

    return CommandResult(
        completed.stdout,
        completed.stderr,
        completed.returncode,
    )


def run_docker_implementation(
    image: str,
    root: Path,
    token: str,
    expected_private_key: str,
    token_secret_values_set: Collection[str],
    known_secrets: set[str],
) -> ImplementationSummary:
    label = "Dockerized Go"
    inspect_docker_image(image)
    validate_packaged_contract(
        label,
        [
            "docker",
            "run",
            "--rm",
            image,
        ],
        token_secret_values_set,
    )

    prepare_empty_directory(root)

    container_name = f"nordgen-live-{secrets.token_hex(8)}"
    run_identifier = os.environ.get(
        "GITHUB_RUN_ID",
        "local",
    )
    generate_result: CommandResult | None = None

    try:
        generate_result = run_command(
            f"{label} live generation",
            [
                "docker",
                "run",
                "--name",
                container_name,
                "--label",
                f"{DOCKER_ACCEPTANCE_LABEL_KEY}={run_identifier}",
                "--interactive",
                image,
                *generation_arguments(),
            ],
            input_text=f"{token}\n",
        )

        run_command(
            f"{label} output copy",
            [
                "docker",
                "container",
                "cp",
                f"{container_name}:/data/.",
                os.fspath(root),
            ],
            timeout_seconds=120,
        )
    finally:
        active_error = sys.exc_info()[1]

        try:
            cleanup_result = remove_container(container_name)
        except VerificationError:
            if active_error is None:
                raise
        else:
            if cleanup_result.returncode != 0 and active_error is None:
                raise CommandFailure(
                    f"{label} container cleanup",
                    cleanup_result.stdout,
                    cleanup_result.stderr,
                    f"{label} container cleanup failed",
                )

    if generate_result is None:
        raise VerificationError(f"{label} generation did not return a result")

    require_secrets_absent(
        generate_result,
        known_secrets,
        f"{label} live generation",
    )

    tree = validate_generation(
        root,
        generate_result,
        expected_private_key,
        token_secret_values_set,
        label,
    )
    return ImplementationSummary(
        label,
        expected_private_key,
        tree,
    )


def find_output_directory(
    root: Path,
    label: str,
) -> Path:
    entries = sorted(
        root.iterdir(),
        key=lambda path: path.name,
    )
    temporary = [path for path in entries if path.name.startswith(".nordgen-")]
    if temporary:
        raise VerificationError(f"{label} left temporary output behind")

    outputs = [
        path for path in entries if path.is_dir() and OUTPUT_NAME_PATTERN.fullmatch(path.name)
    ]
    if len(outputs) != 1:
        raise VerificationError(
            f"{label} produced {len(outputs)} final output directories; expected one"
        )

    if len(entries) != 1:
        unexpected = ", ".join(path.name for path in entries if path not in outputs)
        raise VerificationError(f"{label} produced unexpected top-level entries: {unexpected}")

    return outputs[0]


def validate_output_trees(
    output: Path,
    label: str,
) -> tuple[Path, Path]:
    try:
        entries = sorted(
            output.iterdir(),
            key=lambda path: path.name,
        )
        actual_names = {path.name for path in entries}
        invalid_names = sorted(
            path.name
            for path in entries
            if path.name in EXPECTED_OUTPUT_TREES and (path.is_symlink() or not path.is_dir())
        )
    except OSError as error:
        raise VerificationError(f"cannot inspect output trees for {label}: {error}") from error

    missing = sorted(EXPECTED_OUTPUT_TREES - actual_names)
    unexpected = sorted(actual_names - EXPECTED_OUTPUT_TREES)
    if missing or unexpected or invalid_names:
        raise VerificationError(
            f"{label} output tree mismatch; "
            f"missing={missing}, "
            f"unexpected={unexpected}, "
            f"invalid={invalid_names}"
        )

    return output / "configs", output / "best_configs"


def validate_mode(
    path: Path,
    expected: int,
) -> None:
    try:
        actual = stat.S_IMODE(
            path.stat(
                follow_symlinks=False,
            ).st_mode
        )
    except OSError as error:
        raise VerificationError(f"cannot inspect permissions for {path}: {error}") from error

    if actual != expected:
        raise VerificationError(
            f"unexpected mode for {path}: {actual:04o}; expected {expected:04o}"
        )


def validate_filesystem(
    output: Path,
    label: str,
) -> None:
    validate_mode(output, 0o700)

    for current_root, directory_names, file_names in os.walk(
        output,
        followlinks=False,
    ):
        current = Path(current_root)

        for name in directory_names:
            path = current / name

            if path.is_symlink():
                raise VerificationError(f"{label} output contains a symbolic link: {path}")
            if not path.is_dir():
                raise VerificationError(f"{label} output contains a non-directory: {path}")

            validate_mode(path, 0o700)

        for name in file_names:
            path = current / name

            if path.is_symlink():
                raise VerificationError(f"{label} output contains a symbolic link: {path}")
            if not path.is_file():
                raise VerificationError(f"{label} output contains a non-regular file: {path}")
            if path.suffix != ".conf":
                raise VerificationError(f"{label} output contains an unexpected file: {path}")

            validate_mode(path, 0o600)


def parse_endpoint(
    value: str,
    path: Path,
) -> None:
    if value.startswith("["):
        closing = value.find("]:")
        if closing < 0:
            raise VerificationError(f"invalid bracketed endpoint in {path}")
        host = value[1:closing]
        port = value[closing + 2 :]
    else:
        host, separator, port = value.rpartition(":")
        if not separator:
            raise VerificationError(f"endpoint has no port in {path}")

    if port != "51820":
        raise VerificationError(f"unexpected endpoint port in {path}")

    try:
        ipaddress.ip_address(host)
    except ValueError as error:
        raise VerificationError(f"endpoint is not an IP address in {path}") from error


def validate_config(
    path: Path,
    private_key: str,
    token_secret_values_set: Collection[str],
) -> None:
    try:
        content = path.read_bytes()
    except OSError as error:
        raise VerificationError(f"cannot read {path}: {error}") from error

    protected_values = tuple(value.encode("utf-8") for value in token_secret_values_set if value)
    if any(value in content for value in protected_values):
        raise VerificationError(f"a protected credential value was written to {path}")

    if not content.endswith(b"\n"):
        raise VerificationError(f"configuration does not end with a newline: {path}")

    try:
        lines = content.decode("utf-8").splitlines()
    except UnicodeDecodeError as error:
        raise VerificationError(f"configuration is not UTF-8: {path}") from error

    expected_dns = ipaddress.ip_address(DNS_ADDRESS).compressed
    expected_lines = {
        0: "[Interface]",
        1: f"PrivateKey = {private_key}",
        2: "Address = 10.5.0.2/16",
        3: f"DNS = {expected_dns}",
        4: "",
        5: "[Peer]",
        7: "AllowedIPs = 0.0.0.0/0, ::/0",
        9: f"PersistentKeepalive = {KEEPALIVE}",
    }

    if len(lines) != 10:
        raise VerificationError(f"unexpected configuration line count in {path}")

    for index, expected in expected_lines.items():
        if lines[index] != expected:
            raise VerificationError(
                f"unexpected configuration line {index + 1} in {path}: {lines[index]!r}"
            )

    public_key_prefix = "PublicKey = "
    if not lines[6].startswith(public_key_prefix):
        raise VerificationError(f"missing public key in {path}")

    validate_wireguard_key(
        lines[6][len(public_key_prefix) :],
        f"public key in {path}",
    )

    endpoint_prefix = "Endpoint = "
    if not lines[8].startswith(endpoint_prefix):
        raise VerificationError(f"missing endpoint in {path}")

    parse_endpoint(
        lines[8][len(endpoint_prefix) :],
        path,
    )


def validate_relative_path(
    path: Path,
    output: Path,
    label: str,
) -> tuple[str, str, str]:
    relative = path.relative_to(output)
    if len(relative.parts) != 5:
        raise VerificationError(f"unexpected output path depth for {label}: {relative}")

    tree_name, combo, country, city, file_name = relative.parts

    if tree_name not in EXPECTED_OUTPUT_TREES:
        raise VerificationError(f"unexpected output tree for {label}: {relative}")

    if not combo or not country or not city or not file_name.endswith(".conf"):
        raise VerificationError(f"invalid output path for {label}: {relative}")

    groups = combo.split("_")
    if REQUIRED_GROUP not in groups:
        raise VerificationError(f"required group is missing from {relative}")
    if FORBIDDEN_GROUP in groups:
        raise VerificationError(f"forbidden group is present in {relative}")

    return combo, country, city


def validate_summary_output(
    result: CommandResult,
    summary: TreeSummary,
    label: str,
) -> None:
    text = combined_output(result)

    for expected in EXPECTED_GENERATION_MESSAGES:
        if expected not in text:
            raise VerificationError(f"{label} output did not contain {expected!r}")

    actual: dict[str, int] = {}
    for name, pattern in SUMMARY_PATTERNS.items():
        match = pattern.search(text)
        if match is None:
            raise VerificationError(f"{label} summary is missing {name}")
        actual[name] = int(match.group(1))

    expected_counts = {
        "total": summary.configs + summary.best,
        "configs": summary.configs,
        "best": summary.best,
    }
    if actual != expected_counts:
        raise VerificationError(f"{label} summary counts were {actual}; expected {expected_counts}")


def validate_generation(
    root: Path,
    result: CommandResult,
    private_key: str,
    token_secret_values_set: Collection[str],
    label: str,
) -> TreeSummary:
    output = find_output_directory(
        root,
        label,
    )
    configs_root, best_root = validate_output_trees(
        output,
        label,
    )
    validate_filesystem(
        output,
        label,
    )

    config_files = sorted(configs_root.rglob("*.conf"))
    best_files = sorted(best_root.rglob("*.conf"))
    if not config_files or not best_files:
        raise VerificationError(f"{label} did not generate both configuration trees")

    config_locations: set[tuple[str, str, str]] = set()
    for path in config_files:
        config_locations.add(
            validate_relative_path(
                path,
                output,
                label,
            )
        )
        validate_config(
            path,
            private_key,
            token_secret_values_set,
        )

    best_locations: set[tuple[str, str, str]] = set()
    for path in best_files:
        location = validate_relative_path(
            path,
            output,
            label,
        )
        if location in best_locations:
            raise VerificationError(f"{label} generated duplicate optimized location {location}")

        best_locations.add(location)
        validate_config(
            path,
            private_key,
            token_secret_values_set,
        )

        counterpart = configs_root / path.relative_to(best_root)
        if not counterpart.is_file():
            raise VerificationError(
                "optimized configuration has no standard counterpart: "
                f"{path.relative_to(best_root)}"
            )

        if path.read_bytes() != counterpart.read_bytes():
            raise VerificationError(
                "optimized configuration differs from its "
                "standard counterpart: "
                f"{path.relative_to(best_root)}"
            )

    if best_locations != config_locations:
        missing = sorted(config_locations - best_locations)
        extra = sorted(best_locations - config_locations)
        raise VerificationError(
            f"{label} optimized location coverage mismatch; "
            f"missing={missing[:5]}, extra={extra[:5]}"
        )

    summary = TreeSummary(
        configs=len(config_files),
        best=len(best_files),
        used_location_fallback=("Location unavailable" in combined_output(result)),
    )
    validate_summary_output(
        result,
        summary,
        label,
    )
    return summary


def scan_tree_for_secrets(
    root: Path,
    secret_values: Collection[str],
) -> None:
    protected_values = tuple(value.encode("utf-8") for value in secret_values if value)

    for current_root, _, file_names in os.walk(
        root,
        followlinks=False,
    ):
        current = Path(current_root)

        for name in file_names:
            path = current / name

            if path.is_symlink() or not path.is_file():
                continue

            try:
                content = path.read_bytes()
            except OSError as error:
                raise VerificationError(f"cannot inspect {path}: {error}") from error

            if any(value in content for value in protected_values):
                raise VerificationError(f"a protected credential value persisted in {path}")


def sanitize_text(
    value: str,
    known_secrets: Collection[str],
) -> str:
    sanitized = value

    for secret_value in sorted(
        known_secrets,
        key=len,
        reverse=True,
    ):
        if secret_value:
            sanitized = sanitized.replace(
                secret_value,
                "[REDACTED]",
            )

    return WIREGUARD_KEY_PATTERN.sub(
        "[REDACTED_WIREGUARD_KEY]",
        sanitized,
    )


def emit_diagnostic(
    label: str,
    value: str,
    known_secrets: Collection[str],
) -> None:
    sanitized = sanitize_text(
        value,
        known_secrets,
    )
    lines = sanitized.splitlines()[-MAX_DIAGNOSTIC_LINES:]
    diagnostic = "\n".join(lines)[-MAX_DIAGNOSTIC_CHARACTERS:]

    if not diagnostic:
        return

    if os.environ.get("GITHUB_ACTIONS") == "true":
        stop_token = f"nordgen-{secrets.token_hex(16)}"
        print(
            f"::stop-commands::{stop_token}",
            file=sys.stderr,
        )
        print(
            f"{label}:\n{diagnostic}",
            file=sys.stderr,
        )
        print(
            f"::{stop_token}::",
            file=sys.stderr,
        )
    else:
        print(
            f"{label}:\n{diagnostic}",
            file=sys.stderr,
        )


def validate_work_root(path: Path) -> Path:
    resolved = path.resolve()

    if resolved == Path(resolved.anchor):
        raise VerificationError("work root cannot be a filesystem root")

    if resolved.exists():
        if not resolved.is_dir():
            raise VerificationError(f"work root is not a directory: {resolved}")
        if any(resolved.iterdir()):
            raise VerificationError(f"work root is not empty: {resolved}")
    else:
        resolved.mkdir(
            parents=True,
            mode=0o700,
        )

    resolved.chmod(0o700)
    return resolved


def execute(
    args: argparse.Namespace,
    token: str,
    token_secret_values_set: Collection[str],
    known_secrets: set[str],
) -> None:
    work_root = validate_work_root(args.work_root)

    python_summary = run_native_implementation(
        "Python wheel",
        args.python_command.resolve(),
        work_root / "python",
        token,
        token_secret_values_set,
        known_secrets,
    )
    go_summary = run_native_implementation(
        "Go binary",
        args.go_command.resolve(),
        work_root / "go",
        token,
        token_secret_values_set,
        known_secrets,
    )

    if python_summary.private_key != go_summary.private_key:
        raise VerificationError("Python and Go returned different NordLynx private keys")

    docker_summary = run_docker_implementation(
        args.docker_image,
        work_root / "docker",
        token,
        python_summary.private_key,
        token_secret_values_set,
        known_secrets,
    )

    scan_tree_for_secrets(
        work_root,
        token_secret_values_set,
    )

    summaries = (
        python_summary,
        go_summary,
        docker_summary,
    )
    for summary in summaries:
        fallback = "yes" if summary.tree.used_location_fallback else "no"
        print(
            f"{summary.label}: "
            f"configs={summary.tree.configs}, "
            f"best={summary.tree.best}, "
            f"location_fallback={fallback}"
        )

    print("Live CLI acceptance passed")


def main() -> int:
    args = parse_args()
    token = os.environ.pop(
        "NORDVPN_ACCESS_TOKEN",
        "",
    )

    if not TOKEN_PATTERN.fullmatch(token):
        print(
            "NORDVPN_ACCESS_TOKEN must contain exactly 64 hexadecimal characters",
            file=sys.stderr,
        )
        return 1

    token_secrets = token_secret_values(token)
    known_secrets = set(token_secrets)
    mask_values(token_secrets)

    try:
        execute(
            args,
            token,
            token_secrets,
            known_secrets,
        )
    except CommandFailure as error:
        emit_diagnostic(
            f"{error.label} stdout",
            error.stdout,
            known_secrets,
        )
        emit_diagnostic(
            f"{error.label} stderr",
            error.stderr,
            known_secrets,
        )
        message = (
            sanitize_text(
                str(error),
                known_secrets,
            )
            .replace("\r", " ")
            .replace("\n", " ")
        )
        print(
            f"Live CLI acceptance failed: {message}",
            file=sys.stderr,
        )
        return 1
    except (
        VerificationError,
        OSError,
        ValueError,
    ) as error:
        message = (
            sanitize_text(
                str(error),
                known_secrets,
            )
            .replace("\r", " ")
            .replace("\n", " ")
        )
        print(
            f"Live CLI acceptance failed: {type(error).__name__}: {message}",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
