from __future__ import annotations

import ast
import json
from pathlib import Path

from perigee import cli
from perigee.storage import Storage

_REPO = Path(__file__).resolve().parents[2]


def test_storage_owns_every_artifact_perigee_writes(tmp_path: Path) -> None:
    storage = Storage.under(tmp_path / "runtime", tmp_path / "settings")
    storage.settings.set_presentation_mode("tabs")
    storage.art.ensure("host", "1", lambda: b"png")

    storage.purge()

    assert storage.settings.read().presentation_mode == "collections"
    assert storage.art.read("host", "1") is None


def test_the_cli_writes_the_settings_the_plugin_reads(tmp_path: Path) -> None:
    """Both the CLI and the plugin build Storage, so the settings verb has to land in
    Decky's settings dir. Rooting it anywhere else edits a file nobody reads."""
    runtime = tmp_path / "runtime"
    settings = tmp_path / "settings"

    cli.main(
        [
            "settings",
            "--runtime-dir",
            str(runtime),
            "--settings-dir",
            str(settings),
            "--presentation-mode",
            "tabs",
        ]
    )

    assert Storage.under(runtime, settings).settings.read().presentation_mode == "tabs"
    assert not (runtime / "settings.json").exists()
    assert json.loads((settings / "settings.json").read_text(encoding="utf-8"))


def test_nothing_constructs_a_settings_store_outside_the_composition_root() -> None:
    """One derivation of the location, so the two callers cannot diverge again."""
    sources = [*sorted(_REPO.glob("py_modules/perigee/*.py")), _REPO / "main.py"]
    offenders = [
        f"{path.name}:{node.lineno}"
        for path in sources
        if path.name not in {"settings.py", "storage.py"}
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
        if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "SettingsStore"
    ]

    assert offenders == []
