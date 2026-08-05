from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest

from perigee.settings import (
    DEFAULT_PRESENTATION_MODE,
    MAX_STREAM_SETTINGS,
    MAX_VALUE_LENGTH,
    SETTINGS_SCHEMA_VERSION,
    PluginSettings,
    SettingsStore,
)

if TYPE_CHECKING:
    from pathlib import Path


def test_absent_file_reads_as_the_default(tmp_path: Path) -> None:
    assert SettingsStore(tmp_path).read() == PluginSettings(DEFAULT_PRESENTATION_MODE)


def test_stores_and_reads_back_a_mode(tmp_path: Path) -> None:
    store = SettingsStore(tmp_path)

    store.set_presentation_mode("tabs")

    assert SettingsStore(tmp_path).read().presentation_mode == "tabs"


def test_corrupt_file_reads_as_the_default_instead_of_raising(tmp_path: Path) -> None:
    (tmp_path / "settings.json").write_text("{not json", encoding="utf-8")

    assert SettingsStore(tmp_path).read() == PluginSettings(DEFAULT_PRESENTATION_MODE)


def test_a_document_from_another_schema_reads_as_the_default(tmp_path: Path) -> None:
    (tmp_path / "settings.json").write_text(
        '{"schema_version": 99, "presentation_mode": "tabs"}',
        encoding="utf-8",
    )

    assert SettingsStore(tmp_path).read() == PluginSettings(DEFAULT_PRESENTATION_MODE)


def test_leaves_no_partial_file_behind(tmp_path: Path) -> None:
    SettingsStore(tmp_path).set_presentation_mode("tabs")

    assert [path.name for path in sorted(tmp_path.iterdir())] == ["settings.json"]


@pytest.mark.parametrize("mode", ["", "x" * (MAX_VALUE_LENGTH + 1)])
def test_refuses_an_unusable_mode(tmp_path: Path, mode: str) -> None:
    with pytest.raises(ValueError, match="Unusable presentation mode"):
        SettingsStore(tmp_path).set_presentation_mode(mode)


def test_stream_settings_round_trip_without_the_backend_naming_one(tmp_path: Path) -> None:
    store = SettingsStore(tmp_path)

    store.set_stream_settings({"anything-the-frontend-invents": 42, "another": "token"})

    assert SettingsStore(tmp_path).read().stream_settings == {
        "anything-the-frontend-invents": 42,
        "another": "token",
    }


def test_stream_settings_survive_a_presentation_mode_change(tmp_path: Path) -> None:
    store = SettingsStore(tmp_path)
    store.set_stream_settings({"fps": 60})

    store.set_presentation_mode("tabs")

    assert store.read().stream_settings == {"fps": 60}


@pytest.mark.parametrize(
    "values",
    [
        {"": 1},
        {"x" * (MAX_VALUE_LENGTH + 1): 1},
        {"key": "x" * (MAX_VALUE_LENGTH + 1)},
        {"key": True},
        {"key": ["not", "scalar"]},
    ],
)
def test_refuses_stream_settings_it_cannot_bound(tmp_path: Path, values: dict[str, object]) -> None:
    with pytest.raises(ValueError, match="unusable key or value"):
        SettingsStore(tmp_path).set_stream_settings(values)


def test_reading_drops_entries_past_the_bound(tmp_path: Path) -> None:
    overflowing = {f"key-{index}": index for index in range(MAX_STREAM_SETTINGS + 10)}
    (tmp_path / "settings.json").write_text(
        json.dumps(
            {
                "schema_version": SETTINGS_SCHEMA_VERSION,
                "presentation_mode": "collections",
                "stream_settings": overflowing,
            }
        ),
        encoding="utf-8",
    )

    assert len(SettingsStore(tmp_path).read().stream_settings) == MAX_STREAM_SETTINGS


def test_matches_the_shared_settings_fixture(fixtures: Path) -> None:
    document = json.loads((fixtures / "plugin_settings.json").read_text(encoding="utf-8"))

    assert PluginSettings.from_json(document).to_json() == document


def test_reads_a_document_written_before_the_applied_marker_went(tmp_path: Path) -> None:
    """Why the schema stays at 2: every device already holds a document of this shape.

    The marker was dropped, not renamed or repurposed, so a stored document carrying it is
    still a schema-2 document and every field left in it means what it always meant. A
    version bump would have reset the streaming settings of everyone who had any.
    """
    (tmp_path / "settings.json").write_text(
        json.dumps(
            {
                "schema_version": SETTINGS_SCHEMA_VERSION,
                "presentation_mode": "tabs",
                "stream_settings": {"fps": 120, "hdr": "off"},
                "applied_stream_settings": {"fps": 60},
            }
        ),
        encoding="utf-8",
    )

    stored = SettingsStore(tmp_path).read()

    assert stored.presentation_mode == "tabs"
    assert stored.stream_settings == {"fps": 120, "hdr": "off"}
    assert "applied_stream_settings" not in stored.to_json()


def test_purge_removes_the_settings(tmp_path: Path) -> None:
    store = SettingsStore(tmp_path)
    store.set_presentation_mode("tabs")

    store.purge()

    assert store.read() == PluginSettings(DEFAULT_PRESENTATION_MODE)


def test_the_default_mode_matches_the_shared_fixture(fixtures: Path) -> None:
    document = json.loads((fixtures / "default_presentation_mode.json").read_text(encoding="utf-8"))

    assert document["default_presentation_mode"] == DEFAULT_PRESENTATION_MODE
