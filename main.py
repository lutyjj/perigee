from __future__ import annotations

import asyncio
import base64
from pathlib import Path
from typing import TYPE_CHECKING

import decky

from perigee.config import moonlight_config_path
from perigee.display import DRM_ROOT, DisplayProbe
from perigee.storage import Storage
from perigee.sync import SyncService, build_sync_service

if TYPE_CHECKING:
    from perigee.model import HostState, JsonObject

# The frontend listens for these while a refresh is in flight, so a slow host
# does not hold up the ones that already answered.
HOST_EVENT = "perigee/host"
REFRESH_DONE_EVENT = "perigee/refresh_done"


class Plugin:
    """Decky adapter. The frontend owns Steam, so shortcut removal lives in its purge action."""

    _storage: Storage
    _sync: SyncService
    _display: DisplayProbe
    _background: set[asyncio.Task[None]]

    async def _main(self) -> None:
        runtime_dir = Path(decky.DECKY_PLUGIN_RUNTIME_DIR)
        self._background = set()
        self._display = DisplayProbe(DRM_ROOT)
        self._storage = Storage.under(runtime_dir, Path(decky.DECKY_PLUGIN_SETTINGS_DIR))
        self._sync = build_sync_service(
            moonlight_config_path(Path(decky.DECKY_USER_HOME)),
            self._storage,
        )
        decky.logger.info("Perigee backend ready, runtime dir %s", runtime_dir)

    async def _unload(self) -> None:
        decky.logger.info("Perigee backend stopped")

    async def _uninstall(self) -> None:
        # Only Python runs at uninstall: no frontend, so Steam shortcuts cannot be
        # removed here. The panel's "remove everything" action is that edge.
        await asyncio.to_thread(self._sync.purge)
        decky.logger.info("Perigee runtime data removed")

    async def last_snapshot(self) -> JsonObject | None:
        """The stored probe result. No network, so the panel can render immediately."""
        stored = await asyncio.to_thread(self._storage.snapshots.read)
        return None if stored is None else stored.to_json()

    async def refresh(self) -> JsonObject:
        """Probe every host at once, emitting each as it lands, then store the result."""
        loop = asyncio.get_running_loop()

        def announce(host: HostState) -> None:
            # The event is fire and forget, but the task has to be held or the
            # loop may collect it before it runs.
            task = loop.create_task(decky.emit(HOST_EVENT, host.to_json()))
            self._background.add(task)
            task.add_done_callback(self._background.discard)

        state = await self._sync.probe_all(on_host=announce)
        await asyncio.to_thread(self._storage.snapshots.write, state)
        document = state.to_json()
        await decky.emit(REFRESH_DONE_EVENT, document)
        decky.logger.info("Refreshed %d hosts, %d errors", len(state.hosts), len(state.errors))
        return document

    async def art_base64(self, host_uuid: str, host_app_id: str) -> str | None:
        payload = await asyncio.to_thread(self._sync.art, host_uuid, host_app_id)
        return base64.b64encode(payload).decode("ascii") if payload is not None else None

    async def display_capabilities(self) -> JsonObject:
        """Read on every panel open: the display can change while the plugin runs."""
        capabilities = await asyncio.to_thread(self._display.capabilities)
        decky.logger.info(
            "Display %s: %s, max refresh %s",
            capabilities.connector,
            capabilities.detection,
            capabilities.max_refresh_hz,
        )
        return capabilities.to_json()

    async def settings(self) -> JsonObject:
        stored = await asyncio.to_thread(self._storage.settings.read)
        return stored.to_json()

    async def set_stream_settings(self, values: JsonObject) -> JsonObject:
        stored = await asyncio.to_thread(self._storage.settings.set_stream_settings, values)
        decky.logger.info("Stored %d streaming settings", len(stored.stream_settings))
        return stored.to_json()

    async def set_presentation_mode(self, mode: str) -> JsonObject:
        stored = await asyncio.to_thread(self._storage.settings.set_presentation_mode, mode)
        decky.logger.info("Presentation mode set to %s", stored.presentation_mode)
        return stored.to_json()

    async def purge(self) -> None:
        await asyncio.to_thread(self._sync.purge)
        decky.logger.info("Perigee runtime data purged")
