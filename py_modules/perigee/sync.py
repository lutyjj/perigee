from __future__ import annotations

import asyncio
import functools
import time
from typing import TYPE_CHECKING, Final, Protocol

from perigee.config import MoonlightConfigError, MoonlightConfigReader
from perigee.gamestream import (
    GameStreamApi,
    GameStreamApp,
    GameStreamClientFactory,
    GameStreamError,
    HostUnreachable,
    PairingRejected,
)
from perigee.model import AppEntry, HostState, HostStatus, SyncError, SyncState

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from perigee.config import ClientIdentity, PairedHost
    from perigee.storage import Storage

# A host that answers nothing still has to stop holding up the others. The socket
# already carries this bound; the wait_for below makes it hold even if it does not,
# at the cost of leaving the worker thread to drain on its own.
PROBE_TIMEOUT_SECONDS: Final = 8.0


class ClientFactory(Protocol):
    def __call__(self, host: PairedHost, identity: ClientIdentity) -> GameStreamApi: ...


class HostProbed(Protocol):
    """Called as each host finishes, so a caller can report progress before the rest land."""

    def __call__(self, host: HostState) -> None: ...


class SyncService:
    """Classifies paired hosts. Talks to the network, never to Steam, never blocks on box art."""

    def __init__(
        self,
        reader: MoonlightConfigReader,
        client_factory: ClientFactory,
        storage: Storage,
        clock: Callable[[], float] = time.time,
        probe_timeout: float = PROBE_TIMEOUT_SECONDS,
    ) -> None:
        self._reader = reader
        self._client_factory = client_factory
        self._storage = storage
        self._clock = clock
        self._probe_timeout = probe_timeout

    def state(self) -> SyncState:
        """Probe every host one after another. The CLI path; the plugin uses probe_all."""
        try:
            config = self._reader.read()
        except MoonlightConfigError as error:
            return self._config_error(error)

        results = [self._host_state(host, config.identity) for host in config.hosts]
        return self._collect(results)

    async def probe_all(self, on_host: HostProbed | None = None) -> SyncState:
        """Probe every host at once, reporting each as it lands rather than at the end."""
        try:
            config = self._reader.read()
        except MoonlightConfigError as error:
            return self._config_error(error)

        results = await asyncio.gather(
            *(self._host_state_async(host, config.identity, on_host) for host in config.hosts),
        )
        return self._collect(results)

    async def _host_state_async(
        self,
        host: PairedHost,
        identity: ClientIdentity,
        on_host: HostProbed | None,
    ) -> tuple[HostState, tuple[SyncError, ...]]:
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(self._host_state, host, identity),
                timeout=self._probe_timeout,
            )
        except TimeoutError:
            result = (self._host(host, "offline"), ())
        if on_host is not None:
            on_host(host=result[0])
        return result

    def _collect(
        self,
        results: list[tuple[HostState, tuple[SyncError, ...]]],
    ) -> SyncState:
        return SyncState(
            captured_at=self._clock(),
            hosts=tuple(state for state, _ in results),
            errors=tuple(error for _, errors in results for error in errors),
        )

    def _config_error(self, error: MoonlightConfigError) -> SyncState:
        return SyncState(
            captured_at=self._clock(),
            hosts=(),
            errors=(SyncError(host_uuid=None, message=str(error)),),
        )

    def art(self, host_uuid: str, host_app_id: str) -> bytes | None:
        """Serve the capsule from the cache, fetching it from the host on a miss."""
        try:
            cached = self._storage.art.read(host_uuid, host_app_id)
            if cached is not None:
                return cached
            config = self._reader.read()
            host = next((paired for paired in config.hosts if paired.uuid == host_uuid), None)
            if host is None:
                return None
            client = self._client_factory(host=host, identity=config.identity)
            path = self._storage.art.ensure(
                host_uuid,
                host_app_id,
                functools.partial(client.app_asset, host_app_id),
            )
            return path.read_bytes()
        except (GameStreamError, MoonlightConfigError, OSError, ValueError):
            return None

    def _host_state(
        self,
        host: PairedHost,
        identity: ClientIdentity,
    ) -> tuple[HostState, tuple[SyncError, ...]]:
        client = self._client_factory(host=host, identity=identity)
        try:
            return self._probe(host, client)
        except PairingRejected as error:
            return self._host(host, "unauthorized"), (self._repair_error(host, error),)
        except HostUnreachable:
            return self._host(host, "offline"), ()
        except GameStreamError as error:
            return self._host(host, "offline"), (SyncError(host.uuid, str(error)),)
        except Exception as error:  # noqa: BLE001
            # One host must never take the refresh down with it.
            return self._host(host, "offline"), (SyncError(host.uuid, repr(error)),)

    def _probe(
        self,
        host: PairedHost,
        client: GameStreamApi,
    ) -> tuple[HostState, tuple[SyncError, ...]]:
        info = client.server_info()
        if info.unique_id.lower() != host.uuid:
            message = (
                f"Host reports uniqueid {info.unique_id}, Moonlight is paired with {host.uuid}"
            )
            return self._host(host, "stale_pairing"), (SyncError(host.uuid, message),)

        entries, duplicates = self._entries(host, client.app_list())
        errors = tuple(
            SyncError(host.uuid, f"{host.hostname} lists {title!r} twice; kept the first")
            for title in duplicates
        )
        return self._host(host, "online", entries), errors

    def _entries(
        self,
        host: PairedHost,
        apps: tuple[GameStreamApp, ...],
    ) -> tuple[tuple[AppEntry, ...], tuple[str, ...]]:
        """One entry per title: the title is what Moonlight streams by, so it is the identity."""
        entries: dict[str, AppEntry] = {}
        duplicates: list[str] = []
        for app in apps:
            if app.title in entries:
                duplicates.append(app.title)
                continue
            entries[app.title] = AppEntry(
                host_app_id=app.host_app_id,
                title=app.title,
                art_cached=self._storage.art.read(host.uuid, app.host_app_id) is not None,
            )
        return tuple(entries.values()), tuple(duplicates)

    @staticmethod
    def _repair_error(host: PairedHost, error: PairingRejected) -> SyncError:
        return SyncError(
            host.uuid,
            f"{host.hostname} refused this client, pair it again in Moonlight ({error})",
        )

    @staticmethod
    def _host(
        host: PairedHost,
        status: HostStatus,
        apps: tuple[AppEntry, ...] = (),
    ) -> HostState:
        return HostState(
            uuid=host.uuid,
            name=host.hostname,
            address=host.address,
            status=status,
            apps=apps,
        )

    def purge(self) -> None:
        """Everything Perigee keeps on disk, settings included."""
        self._storage.purge()


def build_sync_service(conf_path: Path, storage: Storage) -> SyncService:
    return SyncService(
        reader=MoonlightConfigReader(conf_path),
        client_factory=GameStreamClientFactory(storage.identity),
        storage=storage,
    )
