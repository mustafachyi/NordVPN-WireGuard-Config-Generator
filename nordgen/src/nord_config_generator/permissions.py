import os
from pathlib import Path


def secure_output_root(path: Path) -> None:
    if os.name == "nt":
        from .permissions_windows import secure_windows_path

        secure_windows_path(path)
        return
    path.chmod(0o700)
