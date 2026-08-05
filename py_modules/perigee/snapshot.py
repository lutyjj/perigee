from __future__ import annotations

import json
from typing import TYPE_CHECKING, Final

from perigee.model import SyncState, SyncStateFormatError

if TYPE_CHECKING:
    from pathlib import Path

_FILE_NAME: Final = "snapshot.json"


class SnapshotStore:
    """The last probe result, kept so the panel can render before any network I/O."""

    def __init__(self, runtime_dir: Path) -> None:
        self._path = runtime_dir / _FILE_NAME

    def read(self) -> SyncState | None:
        try:
            document = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        try:
            return SyncState.from_json(document)
        except SyncStateFormatError:
            return None

    def write(self, state: SyncState) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        staged = self._path.with_suffix(".partial")
        staged.write_text(json.dumps(state.to_json(), indent=2), encoding="utf-8")
        staged.replace(self._path)

    def purge(self) -> None:
        self._path.unlink(missing_ok=True)
