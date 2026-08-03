import ctypes
import os
from ctypes import wintypes
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    os.name != "nt",
    reason="Windows security descriptor test",
)

TOKEN_QUERY = 0x0008
TOKEN_USER_CLASS = 1
ERROR_INSUFFICIENT_BUFFER = 122
SE_FILE_OBJECT = 1
DACL_SECURITY_INFORMATION = 0x00000004
SE_DACL_PROTECTED = 0x1000
ACCESS_ALLOWED_ACE_TYPE = 0x00
OBJECT_INHERIT_ACE = 0x01
CONTAINER_INHERIT_ACE = 0x02
FILE_ALL_ACCESS = 0x001F01FF


class ACL(ctypes.Structure):
    _fields_ = [
        (
            "revision",
            wintypes.BYTE,
        ),
        (
            "reserved1",
            wintypes.BYTE,
        ),
        (
            "size",
            wintypes.WORD,
        ),
        (
            "ace_count",
            wintypes.WORD,
        ),
        (
            "reserved2",
            wintypes.WORD,
        ),
    ]


class AceHeader(ctypes.Structure):
    _fields_ = [
        (
            "ace_type",
            wintypes.BYTE,
        ),
        (
            "ace_flags",
            wintypes.BYTE,
        ),
        (
            "ace_size",
            wintypes.WORD,
        ),
    ]


class AccessAllowedAce(ctypes.Structure):
    _fields_ = [
        (
            "header",
            AceHeader,
        ),
        (
            "mask",
            wintypes.DWORD,
        ),
        (
            "sid_start",
            wintypes.DWORD,
        ),
    ]


class SidAndAttributes(ctypes.Structure):
    _fields_ = [
        (
            "sid",
            wintypes.LPVOID,
        ),
        (
            "attributes",
            wintypes.DWORD,
        ),
    ]


class TokenUser(ctypes.Structure):
    _fields_ = [
        (
            "user",
            SidAndAttributes,
        )
    ]


def _load_windows_libraries():
    advapi32 = ctypes.WinDLL(
        "advapi32",
        use_last_error=True,
    )
    kernel32 = ctypes.WinDLL(
        "kernel32",
        use_last_error=True,
    )

    kernel32.GetCurrentProcess.argtypes = []
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE

    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    kernel32.LocalFree.argtypes = [wintypes.LPVOID]
    kernel32.LocalFree.restype = wintypes.LPVOID

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

    advapi32.GetAce.argtypes = [
        wintypes.LPVOID,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.LPVOID),
    ]
    advapi32.GetAce.restype = wintypes.BOOL

    advapi32.OpenProcessToken.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.HANDLE),
    ]
    advapi32.OpenProcessToken.restype = wintypes.BOOL

    advapi32.GetTokenInformation.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        wintypes.LPVOID,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.GetTokenInformation.restype = wintypes.BOOL

    advapi32.EqualSid.argtypes = [
        wintypes.LPVOID,
        wintypes.LPVOID,
    ]
    advapi32.EqualSid.restype = wintypes.BOOL

    return advapi32, kernel32


def _current_user_sid(
    advapi32,
    kernel32,
):
    token = wintypes.HANDLE()

    if not advapi32.OpenProcessToken(
        kernel32.GetCurrentProcess(),
        TOKEN_QUERY,
        ctypes.byref(token),
    ):
        raise ctypes.WinError(ctypes.get_last_error())

    try:
        required = wintypes.DWORD()
        ctypes.set_last_error(0)

        if advapi32.GetTokenInformation(
            token,
            TOKEN_USER_CLASS,
            None,
            0,
            ctypes.byref(required),
        ):
            raise AssertionError("token-size query unexpectedly succeeded")

        if ctypes.get_last_error() != ERROR_INSUFFICIENT_BUFFER or required.value == 0:
            raise ctypes.WinError(ctypes.get_last_error())

        buffer = ctypes.create_string_buffer(required.value)

        if not advapi32.GetTokenInformation(
            token,
            TOKEN_USER_CLASS,
            buffer,
            required.value,
            ctypes.byref(required),
        ):
            raise ctypes.WinError(ctypes.get_last_error())

        token_user = ctypes.cast(
            buffer,
            ctypes.POINTER(TokenUser),
        ).contents

        return (
            token_user.user.sid,
            buffer,
        )
    finally:
        if token:
            kernel32.CloseHandle(token)


def test_secure_windows_path_applies_current_user_only_protected_dacl(
    tmp_path: Path,
) -> None:
    from nord_config_generator.permissions_windows import (
        secure_windows_path,
    )

    path = tmp_path / "secure-output"
    path.mkdir()
    secure_windows_path(path)

    (
        advapi32,
        kernel32,
    ) = _load_windows_libraries()

    descriptor = wintypes.LPVOID()
    dacl = wintypes.LPVOID()

    result = advapi32.GetNamedSecurityInfoW(
        str(path),
        SE_FILE_OBJECT,
        DACL_SECURITY_INFORMATION,
        None,
        None,
        ctypes.byref(dacl),
        None,
        ctypes.byref(descriptor),
    )

    assert result == 0
    assert descriptor
    assert dacl

    try:
        control = wintypes.WORD()
        revision = wintypes.DWORD()

        assert advapi32.GetSecurityDescriptorControl(
            descriptor,
            ctypes.byref(control),
            ctypes.byref(revision),
        )
        assert control.value & SE_DACL_PROTECTED

        acl = ctypes.cast(
            dacl,
            ctypes.POINTER(ACL),
        ).contents
        assert acl.ace_count == 1

        ace_pointer = wintypes.LPVOID()
        assert advapi32.GetAce(
            dacl,
            0,
            ctypes.byref(ace_pointer),
        )

        ace = ctypes.cast(
            ace_pointer,
            ctypes.POINTER(AccessAllowedAce),
        ).contents

        assert ace.header.ace_type == ACCESS_ALLOWED_ACE_TYPE
        assert ace.header.ace_flags == (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE)
        assert ace.mask == FILE_ALL_ACCESS

        ace_sid = ctypes.c_void_p(ctypes.addressof(ace) + AccessAllowedAce.sid_start.offset)

        (
            current_sid,
            token_buffer,
        ) = _current_user_sid(
            advapi32,
            kernel32,
        )
        assert token_buffer
        assert advapi32.EqualSid(
            ace_sid,
            current_sid,
        )
    finally:
        kernel32.LocalFree(descriptor)
