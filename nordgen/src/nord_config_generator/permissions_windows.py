import ctypes
from ctypes import wintypes
from pathlib import Path
from typing import Any, Never

TOKEN_QUERY = 0x0008
TOKEN_USER = 1
ERROR_INSUFFICIENT_BUFFER = 122
SE_FILE_OBJECT = 1
SDDL_REVISION_1 = 1
DACL_SECURITY_INFORMATION = 0x00000004
PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000


class PermissionConfigurationError(OSError):
    pass


def secure_windows_path(path: Path) -> None:
    advapi32, kernel32 = _load_libraries()
    token = wintypes.HANDLE()
    sid_string = wintypes.LPWSTR()
    descriptor = wintypes.LPVOID()

    if not advapi32.OpenProcessToken(
        kernel32.GetCurrentProcess(),
        TOKEN_QUERY,
        ctypes.byref(token),
    ):
        _raise_windows_error("open current process token")

    try:
        required = wintypes.DWORD()
        if advapi32.GetTokenInformation(
            token,
            TOKEN_USER,
            None,
            0,
            ctypes.byref(required),
        ):
            raise PermissionConfigurationError(
                "query current user token size unexpectedly succeeded"
            )

        last_error = _get_last_error()
        if required.value == 0 or last_error != ERROR_INSUFFICIENT_BUFFER:
            _raise_windows_error("query current user token size", last_error)

        buffer = ctypes.create_string_buffer(required.value)
        if not advapi32.GetTokenInformation(
            token,
            TOKEN_USER,
            buffer,
            required,
            ctypes.byref(required),
        ):
            _raise_windows_error("read current user token")

        class SidAndAttributes(ctypes.Structure):
            _fields_ = [
                ("sid", wintypes.LPVOID),
                ("attributes", wintypes.DWORD),
            ]

        token_user = ctypes.cast(buffer, ctypes.POINTER(SidAndAttributes)).contents
        if not advapi32.ConvertSidToStringSidW(
            token_user.sid,
            ctypes.byref(sid_string),
        ):
            _raise_windows_error("convert current user SID")
        if not sid_string.value:
            raise PermissionConfigurationError("current user SID was empty")

        sddl = f"D:P(A;OICI;FA;;;{sid_string.value})"
        if not advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl,
            SDDL_REVISION_1,
            ctypes.byref(descriptor),
            None,
        ):
            _raise_windows_error("build current-user-only security descriptor")

        present = wintypes.BOOL()
        defaulted = wintypes.BOOL()
        dacl = wintypes.LPVOID()
        if not advapi32.GetSecurityDescriptorDacl(
            descriptor,
            ctypes.byref(present),
            ctypes.byref(dacl),
            ctypes.byref(defaulted),
        ):
            _raise_windows_error("read current-user-only DACL")
        if not present.value or not dacl:
            raise PermissionConfigurationError("security descriptor did not contain a DACL")

        result = advapi32.SetNamedSecurityInfoW(
            str(path),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            None,
            None,
            dacl,
            None,
        )
        if result != 0:
            raise PermissionConfigurationError(
                f"apply current-user-only DACL: {_format_windows_error(result)}"
            )
    finally:
        if descriptor:
            kernel32.LocalFree(descriptor)
        if sid_string:
            kernel32.LocalFree(ctypes.cast(sid_string, wintypes.LPVOID))
        if token:
            kernel32.CloseHandle(token)


def _load_libraries() -> tuple[Any, Any]:
    win_dll = getattr(ctypes, "WinDLL", None)
    if win_dll is None:
        raise PermissionConfigurationError("Windows DLL loading is unavailable")

    advapi32 = win_dll("advapi32", use_last_error=True)
    kernel32 = win_dll("kernel32", use_last_error=True)

    kernel32.GetCurrentProcess.argtypes = []
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE

    kernel32.LocalFree.argtypes = [wintypes.LPVOID]
    kernel32.LocalFree.restype = wintypes.LPVOID

    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

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

    advapi32.ConvertSidToStringSidW.argtypes = [
        wintypes.LPVOID,
        ctypes.POINTER(wintypes.LPWSTR),
    ]
    advapi32.ConvertSidToStringSidW.restype = wintypes.BOOL

    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.LPVOID),
        ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = wintypes.BOOL

    advapi32.GetSecurityDescriptorDacl.argtypes = [
        wintypes.LPVOID,
        ctypes.POINTER(wintypes.BOOL),
        ctypes.POINTER(wintypes.LPVOID),
        ctypes.POINTER(wintypes.BOOL),
    ]
    advapi32.GetSecurityDescriptorDacl.restype = wintypes.BOOL

    advapi32.SetNamedSecurityInfoW.argtypes = [
        wintypes.LPWSTR,
        ctypes.c_int,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.LPVOID,
        wintypes.LPVOID,
        wintypes.LPVOID,
    ]
    advapi32.SetNamedSecurityInfoW.restype = wintypes.DWORD

    return advapi32, kernel32


def _get_last_error() -> int:
    get_last_error = getattr(ctypes, "get_last_error", None)
    if get_last_error is None:
        raise PermissionConfigurationError("Windows last-error retrieval is unavailable")
    return int(get_last_error())


def _format_windows_error(error_code: int) -> str:
    format_error = getattr(ctypes, "FormatError", None)
    if format_error is None:
        return f"Windows error {error_code}"
    return str(format_error(error_code)).strip()


def _raise_windows_error(
    operation: str,
    error_code: int | None = None,
) -> Never:
    resolved_error = _get_last_error() if error_code is None else error_code
    raise PermissionConfigurationError(f"{operation}: {_format_windows_error(resolved_error)}")
