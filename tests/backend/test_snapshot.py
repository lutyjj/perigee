from __future__ import annotations

from typing import TYPE_CHECKING

from perigee.model import HostState, SyncState
from perigee.snapshot import SnapshotStore

if TYPE_CHECKING:
    from pathlib import Path

_STATE = SyncState(
    captured_at=1750000000.0,
    hosts=(
        HostState(
            uuid="15b43594-35e7-4df6-956b-908ffabb2ef2",
            name="Moonshine",
            address="192.0.2.10",
            status="online",
            apps=(),
        ),
    ),
    errors=(),
)


def test_absent_snapshot_reads_as_none(tmp_path: Path) -> None:
    assert SnapshotStore(tmp_path).read() is None


def test_round_trips_a_stored_state(tmp_path: Path) -> None:
    SnapshotStore(tmp_path).write(_STATE)

    assert SnapshotStore(tmp_path).read() == _STATE


def test_a_snapshot_from_another_schema_reads_as_none(tmp_path: Path) -> None:
    (tmp_path / "snapshot.json").write_text('{"schema_version": 1}', encoding="utf-8")

    assert SnapshotStore(tmp_path).read() is None


def test_leaves_no_partial_file_behind(tmp_path: Path) -> None:
    SnapshotStore(tmp_path).write(_STATE)

    assert [path.name for path in sorted(tmp_path.iterdir())] == ["snapshot.json"]


def test_purge_removes_the_snapshot(tmp_path: Path) -> None:
    store = SnapshotStore(tmp_path)
    store.write(_STATE)

    store.purge()

    assert store.read() is None
