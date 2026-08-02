import os
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows security descriptor test")


def test_secure_windows_path_applies_protected_current_user_dacl(tmp_path: Path) -> None:
    import ctypes
    from ctypes import wintypes

    from nord_config_generator.permissions_windows import secure_windows_path

    path = tmp_path / "secure-output"
    path.mkdir()
    secure_windows_path(path)

    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32.GetNamedSecurityInfoW.argtypes = [
        wintypes.LPWSTR,
        ctypes.c_int,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.LPVOID),
        ctypes.POINTER(wintypes.LPVOID),
        ctypes.POINTER(wintypes.LPVOID),
        ctypes.POINTER(wintypes.LPVOID),
        ctypes.POINTER(wintypes.LPVOID),
    ]
    advapi32.GetNamedSecurityInfoW.restype = wintypes.DWORD
    advapi32.GetSecurityDescriptorControl.argtypes = [
        wintypes.LPVOID,
        ctypes.POINTER(wintypes.WORD),
        ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.GetSecurityDescriptorControl.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [wintypes.LPVOID]
    kernel32.LocalFree.restype = wintypes.LPVOID
    descriptor = wintypes.LPVOID()
    result = advapi32.GetNamedSecurityInfoW(
        str(path),
        1,
        0x00000004,
        None,
        None,
        None,
        None,
        ctypes.byref(descriptor),
    )
    assert result == 0
    try:
        control = wintypes.WORD()
        revision = wintypes.DWORD()
        assert advapi32.GetSecurityDescriptorControl(
            descriptor, ctypes.byref(control), ctypes.byref(revision)
        )
        assert control.value & 0x1000
    finally:
        kernel32.LocalFree(descriptor)
