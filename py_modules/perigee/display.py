from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Final, Literal

from perigee.edid import DisplayMode, EdidError, parse_modes
from perigee.parse import JsonReader

if TYPE_CHECKING:
    from perigee.model import JsonObject

DISPLAY_CAPABILITIES_SCHEMA_VERSION: Final = 1

DRM_ROOT: Final = Path("/sys/class/drm")
_CONNECTOR_GLOB: Final = "card*-*"

DisplayDetection = Literal["detected", "unknown"]


class DisplayCapabilitiesFormatError(Exception):
    pass


_read = JsonReader(DisplayCapabilitiesFormatError)


@dataclass(frozen=True, slots=True)
class DisplayCapabilities:
    """What the connected display reports. No modes is the explicit unknown, never an error."""

    connector: str | None
    modes: tuple[DisplayMode, ...]
    reason: str | None

    @property
    def detection(self) -> DisplayDetection:
        return "detected" if self.modes else "unknown"

    @property
    def max_refresh_hz(self) -> int | None:
        if not self.modes:
            return None
        # Half up, the way the TypeScript mirror's Math.round rounds: both sides derive
        # this field, so they have to derive the same whole number.
        return int(max(mode.refresh_hz for mode in self.modes) + 0.5)

    def to_json(self) -> JsonObject:
        return {
            "schema_version": DISPLAY_CAPABILITIES_SCHEMA_VERSION,
            "detection": self.detection,
            "connector": self.connector,
            "max_refresh_hz": self.max_refresh_hz,
            "modes": [
                {"width": mode.width, "height": mode.height, "refresh_hz": mode.refresh_hz}
                for mode in self.modes
            ],
            "reason": self.reason,
        }

    @staticmethod
    def from_json(value: object) -> DisplayCapabilities:
        root = _read.mapping(value, "display capabilities")
        version = root.get("schema_version")
        if version != DISPLAY_CAPABILITIES_SCHEMA_VERSION:
            raise DisplayCapabilitiesFormatError(
                f"Expected schema {DISPLAY_CAPABILITIES_SCHEMA_VERSION}, "
                f"document declares {version!r}",
            )
        capabilities = DisplayCapabilities(
            connector=_optional_text(root.get("connector"), "connector"),
            modes=tuple(_mode(entry) for entry in _read.array(root.get("modes"), "modes")),
            reason=_optional_text(root.get("reason"), "reason"),
        )
        # Both are read off the modes, so a document that states them differently is
        # a document from some other producer.
        if (
            root.get("detection") != capabilities.detection
            or root.get("max_refresh_hz") != capabilities.max_refresh_hz
        ):
            raise DisplayCapabilitiesFormatError("detection and max_refresh_hz disagree with modes")
        return capabilities


class DisplayProbe:
    """Reads the connected DRM connector's EDID. An unreadable display is a result, not a raise."""

    def __init__(self, drm_root: Path) -> None:
        self._root = drm_root

    def capabilities(self) -> DisplayCapabilities:
        connected = self._connected()
        if not connected:
            return DisplayCapabilities(None, (), "no connected display")
        # Several displays can be connected while only one is being driven.
        chosen = next((entry for entry in connected if _active(entry)), connected[0])
        connector = _connector_name(chosen)

        edid = _read_bytes(chosen / "edid")
        if not edid:
            return DisplayCapabilities(connector, (), "its EDID could not be read")
        try:
            modes = parse_modes(edid)
        except EdidError as error:
            return DisplayCapabilities(connector, (), f"its EDID could not be parsed: {error}")
        if not modes:
            return DisplayCapabilities(connector, (), "its EDID declares no detailed timings")
        return DisplayCapabilities(connector, modes, None)

    def _connected(self) -> list[Path]:
        try:
            entries = sorted(self._root.glob(_CONNECTOR_GLOB))
        except OSError:
            return []
        return [entry for entry in entries if _read_text(entry / "status") == "connected"]


def _connector_name(connector: Path) -> str:
    """`card0-HDMI-A-1` names the card too, which says nothing about the display."""
    _, _, name = connector.name.partition("-")
    return name or connector.name


def _active(connector: Path) -> bool:
    """Every connected connector lists modes, so only `enabled` says which one is driven."""
    return _read_text(connector / "enabled") == "enabled"


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        return ""


def _read_bytes(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError:
        return b""


def _mode(value: object) -> DisplayMode:
    mode = _read.mapping(value, "mode")
    return DisplayMode(
        width=_whole(mode.get("width"), "mode.width"),
        height=_whole(mode.get("height"), "mode.height"),
        refresh_hz=_rate(mode.get("refresh_hz"), "mode.refresh_hz"),
    )


def _whole(value: object, what: str) -> int:
    number = _read.number(value, what)
    if number <= 0 or number != int(number):
        raise DisplayCapabilitiesFormatError(f"Expected a positive whole number for {what}")
    return int(number)


def _rate(value: object, what: str) -> float:
    number = _read.number(value, what)
    if number <= 0:
        raise DisplayCapabilitiesFormatError(f"Expected a positive number for {what}")
    return number


def _optional_text(value: object, what: str) -> str | None:
    return None if value is None else _read.text(value, what)
