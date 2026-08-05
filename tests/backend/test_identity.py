from __future__ import annotations

import stat
import threading
from typing import TYPE_CHECKING

from perigee.config import MoonlightConfigReader
from perigee.identity import IdentityStore

if TYPE_CHECKING:
    import ssl
    from pathlib import Path


def test_materialises_the_key_once_and_keeps_it_private(fixtures: Path, tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    store = IdentityStore(runtime)
    identity = MoonlightConfigReader(fixtures / "Moonlight.conf").read().identity

    first = store.ssl_context(identity)
    key_path = runtime / "client.key"
    written_at = key_path.stat().st_mtime_ns

    assert store.ssl_context(identity) is first
    assert key_path.stat().st_mtime_ns == written_at
    assert stat.S_IMODE(key_path.stat().st_mode) == 0o600


def test_purge_removes_the_materialised_identity(fixtures: Path, tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    store = IdentityStore(runtime)
    store.ssl_context(MoonlightConfigReader(fixtures / "Moonlight.conf").read().identity)

    store.purge()

    assert not (runtime / "client.key").exists()
    assert not (runtime / "client.crt").exists()


def test_parallel_callers_share_one_materialised_identity(fixtures: Path, tmp_path: Path) -> None:
    """Hosts are probed in parallel, and the first version of this raced itself: one
    thread unlinked the key another had just written."""
    runtime = tmp_path / "runtime"
    store = IdentityStore(runtime)
    identity = MoonlightConfigReader(fixtures / "Moonlight.conf").read().identity
    contexts: list[ssl.SSLContext] = []
    failures: list[BaseException] = []

    def materialise() -> None:
        try:
            contexts.append(store.ssl_context(identity))
        except BaseException as error:  # noqa: BLE001
            failures.append(error)

    threads = [threading.Thread(target=materialise) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert failures == []
    assert len({id(context) for context in contexts}) == 1
    assert (runtime / "client.key").is_file()
    assert sorted(path.name for path in runtime.iterdir()) == ["client.crt", "client.key"]
