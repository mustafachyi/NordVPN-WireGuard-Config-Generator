import os
import stat
import sys
from pathlib import Path
from types import ModuleType

import pytest

import nord_config_generator.permissions as permissions


def test_secure_output_root_applies_owner_only_posix_mode(tmp_path: Path) -> None:
    path = tmp_path / "output"
    path.mkdir(mode=0o777)
    permissions.secure_output_root(path)
    if os.name != "nt":
        assert stat.S_IMODE(path.stat().st_mode) == 0o700


def test_secure_output_root_dispatches_to_windows_implementation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    called: list[Path] = []
    module = ModuleType("nord_config_generator.permissions_windows")
    module.secure_windows_path = called.append  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, module.__name__, module)
    monkeypatch.setattr(permissions.os, "name", "nt")
    path = tmp_path / "output"
    path.mkdir()
    permissions.secure_output_root(path)
    assert called == [path]


def test_secure_output_root_propagates_chmod_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "output"
    path.mkdir()
    monkeypatch.setattr(permissions.os, "name", "posix")

    def fail(mode: int) -> None:
        raise OSError("chmod failed")

    monkeypatch.setattr(Path, "chmod", lambda self, mode: fail(mode))
    with pytest.raises(OSError, match="chmod failed"):
        permissions.secure_output_root(path)
