import base64

import pytest

from nord_config_generator.wireguard import WireGuardValueError, validate_key


def test_validate_key_rejects_nonlexical_base64() -> None:
    valid = base64.b64encode(bytes([1]) * 32).decode()
    invalid = [
        f"{valid[:20]}\n{valid[20:]}",
        f"{valid[:20]}\r{valid[20:]}",
        f"{valid[:20]}\t{valid[20:]}",
        f" {valid[1:]}",
        f"-{valid[1:]}",
        f"{valid[:42]}==",
        f"{valid[:43]}A",
    ]

    for value in invalid:
        with pytest.raises(WireGuardValueError):
            validate_key(value)
