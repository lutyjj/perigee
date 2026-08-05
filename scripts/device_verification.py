#!/usr/bin/env python3
"""Runs on the Decky device: drives the deployed CLI harness and checks its verdicts."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from perigee.display import DisplayCapabilities
from perigee.model import HostState, SyncState

# Everything Moonlight is told before the `stream` verb, which is where the flags a
# streaming setting turns into ride. Deliberately blind to which flags exist: the registry
# that names them is the frontend's, and this harness must not become a second copy of it.
_FLAG_SPAN = re.compile(r" com\.moonlight_stream\.Moonlight (.*?)stream ")
_PERIGEE_TAG = "PERIGEE="
# The reserved namespace no descriptor may claim, so the probe cannot collide with a real
# setting and unset it. Pinned to the registry from both sides by
# tests/fixtures/reserved_setting_prefix.json.
_RESERVED_KEY_PREFIX = "perigee-verify-"
_PROBE_KEY = f"{_RESERVED_KEY_PREFIX}probe"

_VDF_OBJECT = 0x00
_VDF_STRING = 0x01
_VDF_INT32 = 0x02
_VDF_OBJECT_END = 0x08


@dataclass(frozen=True, slots=True)
class Expectation:
    plugin_dir: Path
    conf: Path
    work_dir: Path
    online_uuid: str
    stale_uuid: str
    plugin_settings_dir: Path
    display_max_refresh_hz: int
    shortcuts_vdf: Path
    # Set when the caller knows a sync has already run, so "nothing to check" is a failure
    # rather than a fresh device. Off by default: a first run legitimately has no shortcuts.
    require_shortcuts: bool

    @property
    def art_dir(self) -> Path:
        return self.work_dir / "art"


def main() -> int:
    expectation = _parse()
    state = _sync_state(expectation)
    hosts = {host.uuid: host for host in state.hosts}
    failures: list[str] = []

    online = hosts.get(expectation.online_uuid.lower())
    if online is None:
        failures.append(f"host {expectation.online_uuid} is absent from the sync state")
    else:
        _check_online(online, failures)

    stale = hosts.get(expectation.stale_uuid.lower())
    if stale is None:
        failures.append(f"host {expectation.stale_uuid} is absent from the sync state")
    else:
        _expect(
            failures,
            stale.status == "stale_pairing",
            f"{stale.name} is classified stale_pairing",
        )

    _expect(
        failures,
        all(error.host_uuid is not None for error in state.errors),
        "no config-level errors",
    )
    _check_art(expectation, online, failures)
    _check_snapshot(expectation, state, failures)
    _check_settings(expectation, failures)
    _check_display(expectation, failures)
    skipped: list[str] = []
    _check_shortcuts_carry_the_settings(expectation, failures, skipped)

    for failure in failures:
        print(f"FAIL {failure}")
    for skip in skipped:
        print(f"SKIP {skip}")
    if skipped:
        print(
            f"{len(skipped)} check(s) had nothing to run against. "
            "Re-run with VERIFY_REQUIRE_SHORTCUTS=1 to treat that as a failure."
        )
    return 1 if failures else 0


def _check_online(host: HostState, failures: list[str]) -> None:
    _expect(failures, host.status == "online", f"{host.name} status is online")
    _expect(failures, len(host.apps) >= 1, f"{host.name} lists at least one app")


def _check_art(expectation: Expectation, host: HostState | None, failures: list[str]) -> None:
    """`sync-state` no longer prefetches art, so ask for one capsule the way the panel does."""
    if host is None or not host.apps:
        return
    fetched = [
        app.title for app in host.apps if _art(expectation, app.host_app_id, host.uuid) is not None
    ]
    _expect(failures, len(fetched) >= 1, f"fetched box art for {fetched}")
    cached = sorted(expectation.art_dir.rglob("*.png"))
    _expect(
        failures,
        len(cached) >= 1,
        f"{len(cached)} capsule(s) cached under {expectation.art_dir}",
    )


def _check_snapshot(expectation: Expectation, state: SyncState, failures: list[str]) -> None:
    """The panel renders this without touching the network, so it has to be there."""
    completed = _harness(expectation, "snapshot")
    stored = (
        SyncState.from_json(json.loads(completed.stdout)) if completed.returncode == 0 else None
    )
    _expect(failures, stored is not None, "a snapshot was stored for the panel to render")
    if stored is not None:
        _expect(
            failures,
            stored.captured_at == state.captured_at,
            "the stored snapshot is the one the refresh produced",
        )


def _check_settings(expectation: Expectation, failures: list[str]) -> None:
    """The CLI and the plugin must read one settings file, in the plugin's own dir.

    The probe key is deliberately one no descriptor will ever claim. The backend is
    name-blind so it stores this exactly like a real setting, and the run leaves the
    user's own settings as it found them, which the shortcut check below relies on.
    """
    settings_dir = expectation.plugin_settings_dir
    probe_value = 60
    before = _settings(expectation)
    written = _settings(expectation, "--stream", f"{_PROBE_KEY}={probe_value}")
    restored = _settings(expectation, "--unset", _PROBE_KEY)

    _expect(failures, before is not None, f"the settings verb reads {settings_dir}")
    _expect(
        failures,
        written is not None and written.get("stream_settings", {}).get(_PROBE_KEY) == probe_value,
        "the settings verb stores a streaming setting",
    )
    _expect(
        failures,
        restored is not None and _PROBE_KEY not in restored.get("stream_settings", {}),
        "the settings verb returns a streaming setting to inherit",
    )
    _expect(
        failures,
        before is not None
        and restored is not None
        and before.get("stream_settings") == restored.get("stream_settings"),
        "the probe left the user's own streaming settings untouched",
    )


def _check_display(expectation: Expectation, failures: list[str]) -> None:
    """`max_refresh_hz` is the field the frame rate picker builds its list from."""
    completed = _harness(expectation, "display")
    if completed.returncode != 0:
        failures.append("the display verb ran")
        return
    print(completed.stdout)
    capabilities = DisplayCapabilities.from_json(json.loads(completed.stdout))

    _expect(
        failures,
        capabilities.detection == "detected",
        f"the display verb read the connected display on {capabilities.connector}",
    )
    _expect(
        failures,
        capabilities.max_refresh_hz == expectation.display_max_refresh_hz,
        f"it reports a peak of {expectation.display_max_refresh_hz} Hz "
        f"(reported {capabilities.max_refresh_hz})",
    )


def _check_shortcuts_carry_the_settings(
    expectation: Expectation,
    failures: list[str],
    skipped: list[str],
) -> None:
    """The journey gate: a stored streaming setting has to be on the line Steam runs.

    Every unit of that path can pass while the journey is broken, which is exactly how
    shortcuts shipped carrying no flags at all. This reads Steam's own shortcuts file
    rather than anything Perigee wrote, so it can only agree with reality.

    Known limitation: it checks that flags are present, not that they are the current ones.
    Which flags a setting turns into is the frontend registry's to say, and copying that
    table into Python would give the contract a second owner. So a shortcut left carrying
    `--fps 60` after the user moved to 120 passes here; only the frontend journey test
    catches that.
    """
    stored = _settings(expectation)
    if stored is None:
        failures.append("the settings verb answered, so the shortcuts can be checked against it")
        return
    wanted = stored.get("stream_settings", {})

    try:
        options = [
            line
            for line in _launch_options(expectation.shortcuts_vdf.read_bytes())
            if line.startswith(_PERIGEE_TAG)
        ]
    except (OSError, ValueError) as error:
        failures.append(f"{expectation.shortcuts_vdf} is readable as Steam's shortcuts ({error})")
        return

    if not options:
        nothing_synced = f"no Perigee shortcuts in {expectation.shortcuts_vdf}; sync one and re-run"
        (failures if expectation.require_shortcuts else skipped).append(nothing_synced)
        return

    spans = {_flag_span(line) for line in options}
    _expect(
        failures,
        len(spans) == 1,
        f"all {len(options)} Perigee shortcuts carry one set of streaming flags (saw {spans})",
    )
    carried = min(spans)
    if wanted:
        _expect(
            failures,
            carried != "",
            f"{len(wanted)} stored setting(s) reached the shortcuts (they carry {carried!r})",
        )
    else:
        _expect(
            failures,
            carried == "",
            f"no stored settings leaves the shortcuts bare (they carry {carried!r})",
        )


def _flag_span(launch_options: str) -> str:
    found = _FLAG_SPAN.search(launch_options)
    return "" if found is None else found.group(1).strip()


def _launch_options(vdf: bytes) -> list[str]:
    """Every LaunchOptions value in Steam's binary shortcuts file."""
    options: list[str] = []
    index = 0
    while index < len(vdf):
        marker = vdf[index]
        index += 1
        if marker == _VDF_OBJECT_END:
            continue
        if marker == _VDF_OBJECT:
            _, index = _cstring(vdf, index)
        elif marker == _VDF_INT32:
            _, index = _cstring(vdf, index)
            if index + 4 > len(vdf):
                raise ValueError(f"truncated int32 at byte {index}")
            index += 4
        elif marker == _VDF_STRING:
            key, index = _cstring(vdf, index)
            value, index = _cstring(vdf, index)
            if key.lower() == "launchoptions":
                options.append(value)
        else:
            raise ValueError(f"unknown field type {marker:#04x} at byte {index - 1}")
    return options


def _cstring(vdf: bytes, index: int) -> tuple[str, int]:
    end = vdf.find(b"\x00", index)
    if end < 0:
        raise ValueError(f"unterminated string at byte {index}")
    return vdf[index:end].decode("utf-8", errors="replace"), end + 1


def _settings(expectation: Expectation, *arguments: str) -> dict[str, Any] | None:
    completed = _harness(expectation, "settings", *arguments)
    if completed.returncode != 0:
        return None
    parsed: dict[str, Any] = json.loads(completed.stdout)
    return parsed


def _art(expectation: Expectation, host_app_id: str, host_uuid: str) -> Path | None:
    output = expectation.work_dir / f"{host_app_id}.png"
    completed = _harness(
        expectation,
        "art",
        "--host-uuid",
        host_uuid,
        "--host-app-id",
        host_app_id,
        "--output",
        str(output),
    )
    return output if completed.returncode == 0 else None


def _sync_state(expectation: Expectation) -> SyncState:
    completed = _harness(expectation, "refresh")
    if completed.returncode != 0:
        print(completed.stderr, file=sys.stderr)
        raise SystemExit(f"perigee refresh exited {completed.returncode}")
    print(completed.stdout)
    return SyncState.from_json(json.loads(completed.stdout))


def _harness(expectation: Expectation, *arguments: str) -> subprocess.CompletedProcess[str]:
    command = [
        sys.executable,
        "-m",
        "perigee",
        *arguments,
        "--conf",
        str(expectation.conf),
        "--runtime-dir",
        str(expectation.work_dir),
        "--art-dir",
        str(expectation.art_dir),
        "--settings-dir",
        str(expectation.plugin_settings_dir),
    ]
    return subprocess.run(  # noqa: S603
        command,
        capture_output=True,
        text=True,
        check=False,
        env={"PYTHONPATH": str(expectation.plugin_dir / "py_modules"), "PATH": "/usr/bin:/bin"},
    )


def _expect(failures: list[str], condition: bool, description: str) -> None:  # noqa: FBT001
    if condition:
        print(f"PASS {description}")
    else:
        failures.append(description)


def _parse() -> Expectation:
    parser = argparse.ArgumentParser(prog="device_verification")
    parser.add_argument("--plugin-dir", type=Path, required=True)
    parser.add_argument("--conf", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--online-uuid", required=True)
    parser.add_argument("--stale-uuid", required=True)
    parser.add_argument("--plugin-settings-dir", type=Path, required=True)
    parser.add_argument("--display-max-refresh-hz", type=int, required=True)
    parser.add_argument("--shortcuts-vdf", type=Path, required=True)
    parser.add_argument("--require-shortcuts", action="store_true")
    namespace = parser.parse_args()
    return Expectation(
        plugin_dir=Path(str(namespace.plugin_dir)),
        conf=Path(str(namespace.conf)),
        work_dir=Path(str(namespace.work_dir)),
        online_uuid=str(namespace.online_uuid),
        stale_uuid=str(namespace.stale_uuid),
        plugin_settings_dir=Path(str(namespace.plugin_settings_dir)),
        display_max_refresh_hz=int(namespace.display_max_refresh_hz),
        shortcuts_vdf=Path(str(namespace.shortcuts_vdf)),
        require_shortcuts=bool(namespace.require_shortcuts),
    )


if __name__ == "__main__":
    raise SystemExit(main())
