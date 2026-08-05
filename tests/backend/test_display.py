from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest
from synthetic_edid import QHD_120, UHD_60, edid

from perigee.display import (
    DISPLAY_CAPABILITIES_SCHEMA_VERSION,
    DisplayCapabilities,
    DisplayCapabilitiesFormatError,
    DisplayProbe,
)
from perigee.edid import DisplayMode

if TYPE_CHECKING:
    from pathlib import Path

_TV = edid(UHD_60, QHD_120)


def _connector(
    root: Path,
    name: str,
    *,
    status: str,
    enabled: str | None = None,
    display: bytes | None = None,
) -> None:
    directory = root / name
    directory.mkdir(parents=True)
    (directory / "status").write_text(status, encoding="utf-8")
    if enabled is not None:
        (directory / "enabled").write_text(enabled, encoding="utf-8")
    if display is not None:
        (directory / "edid").write_bytes(display)


def test_an_absent_drm_root_reports_unknown(tmp_path: Path) -> None:
    capabilities = DisplayProbe(tmp_path / "nothing-here").capabilities()

    assert capabilities.detection == "unknown"
    assert capabilities.connector is None
    assert capabilities.max_refresh_hz is None
    assert capabilities.reason == "no connected display"


def test_only_disconnected_connectors_report_unknown(tmp_path: Path) -> None:
    _connector(tmp_path, "card0-DP-1", status="disconnected", enabled="disabled")
    _connector(tmp_path, "card0-Writeback-1", status="unknown", enabled="disabled")

    assert DisplayProbe(tmp_path).capabilities().reason == "no connected display"


def test_reads_the_connected_connector(tmp_path: Path) -> None:
    _connector(tmp_path, "card0-DP-1", status="disconnected", enabled="disabled")
    _connector(tmp_path, "card0-HDMI-A-1", status="connected", enabled="enabled", display=_TV)

    capabilities = DisplayProbe(tmp_path).capabilities()

    assert capabilities.detection == "detected"
    assert capabilities.connector == "HDMI-A-1"
    assert capabilities.max_refresh_hz == 120
    assert capabilities.reason is None
    assert DisplayMode(width=2560, height=1440, refresh_hz=119.998) in capabilities.modes


def test_prefers_a_connected_connector_that_is_driving_a_mode(tmp_path: Path) -> None:
    _connector(tmp_path, "card0-DP-1", status="connected", enabled="disabled", display=_TV)
    _connector(tmp_path, "card0-HDMI-A-1", status="connected", enabled="enabled", display=_TV)

    assert DisplayProbe(tmp_path).capabilities().connector == "HDMI-A-1"


def test_a_connector_without_an_enabled_attribute_is_not_driving(tmp_path: Path) -> None:
    _connector(tmp_path, "card0-DP-1", status="connected", display=_TV)
    _connector(tmp_path, "card0-HDMI-A-1", status="connected", enabled="enabled", display=_TV)

    assert DisplayProbe(tmp_path).capabilities().connector == "HDMI-A-1"


def test_takes_the_first_connected_connector_when_none_is_driving_a_mode(tmp_path: Path) -> None:
    _connector(tmp_path, "card0-DP-1", status="connected", enabled="disabled", display=_TV)
    _connector(tmp_path, "card0-HDMI-A-1", status="connected", enabled="disabled", display=_TV)

    assert DisplayProbe(tmp_path).capabilities().connector == "DP-1"


def test_an_unreadable_edid_reports_unknown_against_the_connector_it_found(tmp_path: Path) -> None:
    _connector(tmp_path, "card0-HDMI-A-1", status="connected", enabled="enabled")

    capabilities = DisplayProbe(tmp_path).capabilities()

    assert capabilities.detection == "unknown"
    assert capabilities.connector == "HDMI-A-1"
    assert capabilities.reason == "its EDID could not be read"


def test_an_unparseable_edid_reports_unknown_rather_than_raising(tmp_path: Path) -> None:
    _connector(tmp_path, "card0-HDMI-A-1", status="connected", enabled="enabled", display=b"junk")

    capabilities = DisplayProbe(tmp_path).capabilities()

    assert capabilities.detection == "unknown"
    assert capabilities.reason is not None
    assert capabilities.reason.startswith("its EDID could not be parsed")


def test_an_edid_without_timings_reports_unknown(tmp_path: Path) -> None:
    _connector(tmp_path, "card0-HDMI-A-1", status="connected", enabled="enabled", display=edid())

    assert DisplayProbe(tmp_path).capabilities().reason == "its EDID declares no detailed timings"


def test_matches_the_shared_capabilities_fixture(fixtures: Path) -> None:
    document = json.loads((fixtures / "display_capabilities.json").read_text(encoding="utf-8"))

    assert DisplayCapabilities.from_json(document).to_json() == document


def test_an_unknown_result_round_trips_too() -> None:
    unknown = DisplayCapabilities(None, (), "no connected display")

    assert DisplayCapabilities.from_json(unknown.to_json()) == unknown


@pytest.mark.parametrize(
    ("refresh_hz", "peak"),
    [(59.5, 60), (60.5, 61), (119.998, 120)],
)
def test_the_peak_rate_rounds_half_up_the_way_the_frontend_rounds(
    refresh_hz: float,
    peak: int,
) -> None:
    mode = DisplayMode(width=1920, height=1080, refresh_hz=refresh_hz)

    assert DisplayCapabilities("HDMI-A-1", (mode,), None).max_refresh_hz == peak


@pytest.mark.parametrize(
    "damage",
    [
        {"schema_version": DISPLAY_CAPABILITIES_SCHEMA_VERSION + 1},
        {"detection": "unknown"},
        {"max_refresh_hz": 120},
        {"modes": "not-an-array"},
        {"modes": []},
        {"detection": "detected", "max_refresh_hz": 240, "modes": []},
        {"modes": [{"width": 0, "height": 2160, "refresh_hz": 60.0}]},
        {"modes": [{"width": 3840, "height": 2160, "refresh_hz": "sixty"}]},
        {"connector": 1},
    ],
)
def test_rejects_a_document_it_did_not_produce(damage: dict[str, object]) -> None:
    document = DisplayCapabilities(
        "HDMI-A-1",
        (DisplayMode(width=3840, height=2160, refresh_hz=60.0),),
        None,
    ).to_json()

    with pytest.raises(DisplayCapabilitiesFormatError):
        DisplayCapabilities.from_json({**document, **damage})
