from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from perigee.art import ArtCache
from perigee.identity import IdentityStore
from perigee.settings import SettingsStore
from perigee.snapshot import SnapshotStore

if TYPE_CHECKING:
    from pathlib import Path


@dataclass(frozen=True, slots=True)
class Storage:
    """Everything Perigee owns on disk, so one object answers for its lifecycle."""

    art: ArtCache
    identity: IdentityStore
    snapshots: SnapshotStore
    settings: SettingsStore

    @staticmethod
    def under(runtime_dir: Path, settings_dir: Path | None = None) -> Storage:
        """Decky keeps settings outside the runtime dir, so it is the one separate root."""
        return Storage(
            art=ArtCache(runtime_dir / "art"),
            identity=IdentityStore(runtime_dir),
            snapshots=SnapshotStore(runtime_dir),
            settings=SettingsStore(settings_dir if settings_dir is not None else runtime_dir),
        )

    def purge(self) -> None:
        """Removes everything Perigee created, the user's settings included."""
        self.art.purge()
        self.snapshots.purge()
        self.identity.purge()
        self.settings.purge()
