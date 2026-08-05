from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from collections.abc import Mapping
    from pathlib import Path

    from perigee.model import JsonObject

SETTINGS_SCHEMA_VERSION: Final = 2

_FILE_NAME: Final = "settings.json"
# The frontend owns what these values mean; the backend only has to keep them, so it
# bounds their size rather than their membership.
MAX_VALUE_LENGTH: Final = 64
MAX_STREAM_SETTINGS: Final = 64
DEFAULT_PRESENTATION_MODE: Final = "collections"

StreamSettingValue = str | float
StreamSettings = dict[str, StreamSettingValue]


@dataclass(frozen=True, slots=True)
class PluginSettings:
    """The plugin's own preferences. `stream_settings` is opaque here by design."""

    presentation_mode: str = DEFAULT_PRESENTATION_MODE
    stream_settings: StreamSettings = field(default_factory=dict)

    def to_json(self) -> JsonObject:
        return {
            "schema_version": SETTINGS_SCHEMA_VERSION,
            "presentation_mode": self.presentation_mode,
            "stream_settings": dict(self.stream_settings),
        }

    @staticmethod
    def from_json(value: object) -> PluginSettings:
        if not isinstance(value, dict):
            return PluginSettings()
        if value.get("schema_version") != SETTINGS_SCHEMA_VERSION:
            return PluginSettings()
        mode = value.get("presentation_mode")
        if not isinstance(mode, str) or not mode or len(mode) > MAX_VALUE_LENGTH:
            return PluginSettings()
        return PluginSettings(
            presentation_mode=mode,
            stream_settings=bounded_stream_settings(value.get("stream_settings")),
        )


def bounded_stream_settings(value: object) -> StreamSettings:
    """Accept any key the frontend chose, as long as it stays small and printable."""
    if not isinstance(value, dict):
        return {}
    settings: StreamSettings = {}
    for key, stored in value.items():
        if len(settings) >= MAX_STREAM_SETTINGS:
            break
        if _usable(key, stored):
            settings[key] = stored
    return settings


def _usable(key: object, value: object) -> bool:
    if not isinstance(key, str) or not key or len(key) > MAX_VALUE_LENGTH:
        return False
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return True
    return isinstance(value, str) and len(value) <= MAX_VALUE_LENGTH


class SettingsStore:
    """A settings file that is either the old value or the new one, never a mixture."""

    def __init__(self, directory: Path) -> None:
        self._path = directory / _FILE_NAME

    def read(self) -> PluginSettings:
        try:
            document = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return PluginSettings()
        return PluginSettings.from_json(document)

    def set_presentation_mode(self, mode: str) -> PluginSettings:
        if not mode or len(mode) > MAX_VALUE_LENGTH:
            raise ValueError(f"Unusable presentation mode: {mode!r}")
        return self._store(replace(self.read(), presentation_mode=mode))

    def set_stream_settings(self, values: Mapping[str, object]) -> PluginSettings:
        bounded = bounded_stream_settings(dict(values))
        if len(bounded) != len(values):
            raise ValueError("Stream settings carry an unusable key or value")
        return self._store(replace(self.read(), stream_settings=bounded))

    def purge(self) -> None:
        self._path.unlink(missing_ok=True)

    def _store(self, settings: PluginSettings) -> PluginSettings:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        staged = self._path.with_suffix(".partial")
        staged.write_text(json.dumps(settings.to_json(), indent=2), encoding="utf-8")
        staged.replace(self._path)
        return settings
