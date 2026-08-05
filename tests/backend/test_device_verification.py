"""The reader behind `make verify`'s journey gate, which no other test can reach."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import device_verification
from device_verification import _flag_span, _launch_options

_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"

_MOONLIGHT = "run com.moonlight_stream.Moonlight"


def test_the_probe_key_sits_in_the_reserved_namespace() -> None:
    """The frontend asserts no descriptor claims this prefix; this ties the probe to it.

    Without the pin, a registry entry could one day be keyed like the probe, and the
    probe's `--unset` would delete a setting the user chose.
    """
    shared = json.loads((_FIXTURES / "reserved_setting_prefix.json").read_text(encoding="utf-8"))

    assert shared["reserved_setting_key_prefix"] == device_verification._RESERVED_KEY_PREFIX
    assert device_verification._PROBE_KEY.startswith(device_verification._RESERVED_KEY_PREFIX)


def _string(key: str, value: str) -> bytes:
    return b"\x01" + key.encode() + b"\x00" + value.encode() + b"\x00"


def _int32(key: str, value: int) -> bytes:
    return b"\x02" + key.encode() + b"\x00" + value.to_bytes(4, "little")


def _object(name: str, *fields: bytes) -> bytes:
    return b"\x00" + name.encode() + b"\x00" + b"".join(fields) + b"\x08"


def _shortcuts(*entries: bytes) -> bytes:
    """Steam's binary keyvalues, in the shape a real shortcuts.vdf carries."""
    return _object("shortcuts", *entries) + b"\x08"


def test_reads_every_launch_options_value() -> None:
    vdf = _shortcuts(
        _object(
            "0",
            _int32("appid", 3695462126),
            _string("AppName", "Desktop"),
            _string("LaunchOptions", "PERIGEE=abc:1 %command% first"),
            _int32("IsHidden", 0),
        ),
        _object(
            "1",
            _string("AppName", "Factorio"),
            _string("LaunchOptions", "PERIGEE=abc:2 %command% second"),
        ),
    )

    assert _launch_options(vdf) == [
        "PERIGEE=abc:1 %command% first",
        "PERIGEE=abc:2 %command% second",
    ]


def test_ignores_a_shortcut_that_is_not_perigees() -> None:
    vdf = _shortcuts(
        _object("0", _string("LaunchOptions", '"run" "--branch=stable" "com.example.App"')),
    )

    assert _launch_options(vdf) == ['"run" "--branch=stable" "com.example.App"']


def test_refuses_bytes_it_cannot_walk_rather_than_guessing() -> None:
    # A desync would yield plausible nonsense, and the gate would then pass on garbage.
    with pytest.raises(ValueError, match="unknown field type"):
        _launch_options(b"\x07unsupported\x00")


@pytest.mark.parametrize(
    ("truncated", "expected"),
    [
        (b"\x02appid\x00\x01\x02", "truncated int32"),
        (b"\x01LaunchOptions\x00no terminator", "unterminated string"),
        (b"\x01no terminator", "unterminated string"),
    ],
)
def test_refuses_a_truncated_file_rather_than_reporting_what_it_managed_to_read(
    truncated: bytes, expected: str
) -> None:
    """A short read must fail the gate, never quietly shorten the list it checks."""
    with pytest.raises(ValueError, match=expected):
        _launch_options(truncated)


@pytest.mark.parametrize(
    ("options", "expected"),
    [
        (f'PERIGEE=a:1 %command% {_MOONLIGHT} stream 192.0.2.10 "App" --quit-after', ""),
        (
            f'PERIGEE=a:1 %command% {_MOONLIGHT} --fps 60 stream 192.0.2.10 "App" --quit-after',
            "--fps 60",
        ),
        (
            (
                f"PERIGEE=a:1 %command% {_MOONLIGHT} --hdr --performance-overlay "
                'stream 192.0.2.10 "App" --quit-after'
            ),
            "--hdr --performance-overlay",
        ),
    ],
)
def test_reads_the_flags_a_launch_line_carries(options: str, expected: str) -> None:
    assert _flag_span(options) == expected


def test_a_line_with_no_stream_verb_carries_no_flags() -> None:
    assert _flag_span("PERIGEE=a:1 %command% something else entirely") == ""


def _perigee_shortcuts(*launch_options: str) -> bytes:
    return _shortcuts(
        *(
            _object(str(index), _string("LaunchOptions", line))
            for index, line in enumerate(launch_options)
        )
    )


def _run_gate(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    vdf: bytes,
    stored: dict[str, object],
    *,
    require_shortcuts: bool,
) -> tuple[list[str], list[str]]:
    path = tmp_path / "shortcuts.vdf"
    path.write_bytes(vdf)
    monkeypatch.setattr(device_verification, "_settings", lambda *_: {"stream_settings": stored})
    expectation = device_verification.Expectation(
        plugin_dir=tmp_path,
        conf=tmp_path / "Moonlight.conf",
        work_dir=tmp_path,
        online_uuid="online",
        stale_uuid="stale",
        plugin_settings_dir=tmp_path,
        display_max_refresh_hz=120,
        shortcuts_vdf=path,
        require_shortcuts=require_shortcuts,
    )
    failures: list[str] = []
    skipped: list[str] = []
    device_verification._check_shortcuts_carry_the_settings(expectation, failures, skipped)
    return failures, skipped


_BARE = (
    'PERIGEE=a:1 %command% run com.moonlight_stream.Moonlight stream 192.0.2.10 "App" --quit-after'
)
_FLAGGED = (
    "PERIGEE=a:1 %command% run com.moonlight_stream.Moonlight --fps 120 "
    'stream 192.0.2.10 "App" --quit-after'
)


def test_fails_when_stored_settings_reached_no_shortcut(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The P0 itself: settings on disk, nothing on the launch line."""
    failures, skipped = _run_gate(
        monkeypatch, tmp_path, _perigee_shortcuts(_BARE), {"fps": 120}, require_shortcuts=False
    )

    assert skipped == []
    assert len(failures) == 1
    assert "reached the shortcuts" in failures[0]


def test_passes_when_the_flags_are_there(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    failures, skipped = _run_gate(
        monkeypatch, tmp_path, _perigee_shortcuts(_FLAGGED), {"fps": 120}, require_shortcuts=False
    )

    assert (failures, skipped) == ([], [])


def test_a_device_with_no_synced_shortcuts_is_reported_not_swallowed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    failures, skipped = _run_gate(
        monkeypatch, tmp_path, _shortcuts(), {"fps": 120}, require_shortcuts=False
    )

    assert failures == []
    assert len(skipped) == 1


def test_nothing_to_check_is_a_failure_when_the_caller_says_a_sync_ran(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    failures, skipped = _run_gate(
        monkeypatch, tmp_path, _shortcuts(), {"fps": 120}, require_shortcuts=True
    )

    assert skipped == []
    assert len(failures) == 1


def test_no_stored_settings_wants_bare_shortcuts(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    failures, _ = _run_gate(
        monkeypatch, tmp_path, _perigee_shortcuts(_FLAGGED), {}, require_shortcuts=False
    )

    assert len(failures) == 1
    assert "bare" in failures[0]


def test_shortcuts_disagreeing_on_their_flags_is_a_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    failures, _ = _run_gate(
        monkeypatch,
        tmp_path,
        _perigee_shortcuts(_FLAGGED, _BARE),
        {"fps": 120},
        require_shortcuts=False,
    )

    assert any("one set of streaming flags" in failure for failure in failures)
