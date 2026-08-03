import base64
import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "live_cli_acceptance.py"


def load_acceptance_module() -> ModuleType:
    module_name = "nordgen_live_cli_acceptance"
    specification = importlib.util.spec_from_file_location(
        module_name,
        SCRIPT_PATH,
    )
    if specification is None or specification.loader is None:
        raise RuntimeError("could not load live CLI acceptance module")

    module = importlib.util.module_from_spec(specification)
    sys.modules[module_name] = module
    specification.loader.exec_module(module)
    return module


acceptance = load_acceptance_module()


def test_token_secret_values_cover_case_and_basic_encoding_without_whitespace() -> None:
    token = "aB" * 32
    values = acceptance.token_secret_values(token)

    for variant in {
        token,
        token.lower(),
        token.upper(),
    }:
        encoded = base64.b64encode(f"token:{variant}".encode("ascii")).decode("ascii")
        assert variant in values
        assert encoded in values

    assert all(not any(character.isspace() for character in value) for value in values)


def test_wireguard_secret_values_include_unpadded_form() -> None:
    private_key = base64.b64encode(bytes([1]) * 32).decode()

    assert acceptance.wireguard_secret_values(private_key) == {
        private_key,
        private_key.removesuffix("="),
    }


def test_sanitize_text_removes_credentials_and_wireguard_keys() -> None:
    token = "aB" * 32
    token_values = acceptance.token_secret_values(token)
    private_key = base64.b64encode(bytes([1]) * 32).decode()
    private_key_values = acceptance.wireguard_secret_values(private_key)
    known_secrets = token_values | private_key_values
    source = " ".join(
        [
            *known_secrets,
            private_key,
        ]
    )

    sanitized = acceptance.sanitize_text(
        source,
        known_secrets,
    )

    for value in known_secrets:
        assert value not in sanitized
    assert private_key not in sanitized
    assert "[REDACTED]" in sanitized


def test_validate_output_trees_accepts_exact_contract(
    tmp_path: Path,
) -> None:
    configs = tmp_path / "configs"
    best_configs = tmp_path / "best_configs"
    configs.mkdir()
    best_configs.mkdir()

    assert acceptance.validate_output_trees(
        tmp_path,
        "test",
    ) == (
        configs,
        best_configs,
    )


def test_validate_output_trees_rejects_unexpected_entry(
    tmp_path: Path,
) -> None:
    (tmp_path / "configs").mkdir()
    (tmp_path / "best_configs").mkdir()
    (tmp_path / "debug").mkdir()

    with pytest.raises(
        acceptance.VerificationError,
        match=r"unexpected=\['debug'\]",
    ):
        acceptance.validate_output_trees(
            tmp_path,
            "test",
        )


def test_validate_config_accepts_expected_contract(
    tmp_path: Path,
) -> None:
    private_key = base64.b64encode(bytes([1]) * 32).decode()
    public_key = base64.b64encode(bytes([2]) * 32).decode()
    path = tmp_path / "server.conf"
    path.write_text(
        "\n".join(
            [
                "[Interface]",
                f"PrivateKey = {private_key}",
                "Address = 10.5.0.2/16",
                f"DNS = {acceptance.DNS_ADDRESS}",
                "",
                "[Peer]",
                f"PublicKey = {public_key}",
                "AllowedIPs = 0.0.0.0/0, ::/0",
                "Endpoint = 192.0.2.1:51820",
                (f"PersistentKeepalive = {acceptance.KEEPALIVE}"),
                "",
            ]
        ),
        encoding="utf-8",
    )

    acceptance.validate_config(
        path,
        private_key,
        acceptance.token_secret_values("a" * 64),
    )


def test_validate_config_rejects_protected_credentials(
    tmp_path: Path,
) -> None:
    token = "a" * 64
    private_key = base64.b64encode(bytes([1]) * 32).decode()
    public_key = base64.b64encode(bytes([2]) * 32).decode()
    path = tmp_path / "server.conf"
    path.write_text(
        "\n".join(
            [
                "[Interface]",
                f"PrivateKey = {private_key}",
                "Address = 10.5.0.2/16",
                f"DNS = {acceptance.DNS_ADDRESS}",
                "",
                "[Peer]",
                f"PublicKey = {public_key}",
                "AllowedIPs = 0.0.0.0/0, ::/0",
                "Endpoint = 192.0.2.1:51820",
                (f"PersistentKeepalive = {acceptance.KEEPALIVE}"),
                token,
                "",
            ]
        ),
        encoding="utf-8",
    )

    with pytest.raises(
        acceptance.VerificationError,
        match="protected credential",
    ):
        acceptance.validate_config(
            path,
            private_key,
            acceptance.token_secret_values(token),
        )


def test_validate_summary_output_accepts_matching_counts() -> None:
    summary = acceptance.TreeSummary(
        configs=2,
        best=1,
        used_location_fallback=False,
    )
    output = "\n".join(
        [
            *acceptance.EXPECTED_GENERATION_MESSAGES,
            "Total Files Written: 3",
            "Standard: 2",
            "Optimized: 1",
        ]
    )
    result = acceptance.CommandResult(
        stdout=output,
        stderr="",
        returncode=0,
    )

    acceptance.validate_summary_output(
        result,
        summary,
        "test implementation",
    )
