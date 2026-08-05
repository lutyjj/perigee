from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from perigee.art import ArtCache

if TYPE_CHECKING:
    from pathlib import Path

_HOST = "15b43594-35e7-4df6-956b-908ffabb2ef2"
_PNG = b"\x89PNG\r\n\x1a\ncapsule"


def test_fetches_once_and_reads_back(tmp_path: Path) -> None:
    cache = ArtCache(tmp_path)
    fetches = 0

    def fetch() -> bytes:
        nonlocal fetches
        fetches += 1
        return _PNG

    cache.ensure(_HOST, "1", fetch)
    cache.ensure(_HOST, "1", fetch)

    assert fetches == 1
    assert cache.read(_HOST, "1") == _PNG


def test_missing_entry_reads_as_none(tmp_path: Path) -> None:
    assert ArtCache(tmp_path).read(_HOST, "1") is None


@pytest.mark.parametrize("segment", ["../escape", "a/b", "", ".", ".."])
def test_rejects_path_escaping_identifiers(tmp_path: Path, segment: str) -> None:
    cache = ArtCache(tmp_path)

    with pytest.raises(ValueError, match="Unsafe cache path segment"):
        cache.path_for(_HOST, segment)
    with pytest.raises(ValueError, match="Unsafe cache path segment"):
        cache.path_for(segment, "1")


def test_purge_removes_every_cached_capsule(tmp_path: Path) -> None:
    cache = ArtCache(tmp_path / "art")
    cache.ensure(_HOST, "1", lambda: _PNG)

    cache.purge()

    assert cache.read(_HOST, "1") is None
