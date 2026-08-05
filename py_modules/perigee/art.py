from __future__ import annotations

import re
import shutil
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

# `.` and `..` match the character class but name directories, not cache entries.
_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9._-]+$")
_RESERVED_SEGMENTS = frozenset({".", ".."})
_EXTENSION: Final = ".png"


class ArtCache:
    def __init__(self, root: Path) -> None:
        self._root = root

    def path_for(self, host_uuid: str, host_app_id: str) -> Path:
        return self._root / _safe(host_uuid) / f"{_safe(host_app_id)}{_EXTENSION}"

    def read(self, host_uuid: str, host_app_id: str) -> bytes | None:
        path = self.path_for(host_uuid, host_app_id)
        return path.read_bytes() if path.is_file() else None

    def purge(self) -> None:
        shutil.rmtree(self._root, ignore_errors=True)

    def ensure(self, host_uuid: str, host_app_id: str, fetch: Callable[[], bytes]) -> Path:
        path = self.path_for(host_uuid, host_app_id)
        if path.is_file():
            return path
        payload = fetch()
        path.parent.mkdir(parents=True, exist_ok=True)
        staged = path.with_suffix(".partial")
        staged.write_bytes(payload)
        staged.replace(path)
        return path


def _safe(segment: str) -> str:
    if segment in _RESERVED_SEGMENTS or not _SAFE_SEGMENT.match(segment):
        raise ValueError(f"Unsafe cache path segment: {segment!r}")
    return segment
