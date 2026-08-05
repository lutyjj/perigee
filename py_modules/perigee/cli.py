from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING, Final

from perigee.art import ArtCache
from perigee.config import moonlight_config_path
from perigee.display import DRM_ROOT, DisplayProbe
from perigee.storage import Storage
from perigee.sync import build_sync_service

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence

    from perigee.model import JsonObject
    from perigee.sync import SyncService

_DEFAULT_RUNTIME_DIR: Final = Path.home() / ".local" / "state" / "perigee"


@dataclass(frozen=True, slots=True)
class Options:
    """argparse hands back `Any`; every verb reads its arguments through this typed view."""

    command: str
    conf: Path
    runtime_dir: Path
    art_dir: Path | None
    host_uuid: str
    host_app_id: str
    output: Path | None
    mode: str
    stream_settings: dict[str, str | float]
    unset: tuple[str, ...]
    settings_dir: Path | None
    drm_root: Path

    @staticmethod
    def from_namespace(namespace: argparse.Namespace) -> Options:
        return Options(
            command=str(namespace.command),
            conf=Path(str(namespace.conf)),
            runtime_dir=Path(str(namespace.runtime_dir)),
            art_dir=None if namespace.art_dir is None else Path(str(namespace.art_dir)),
            host_uuid=str(getattr(namespace, "host_uuid", "")),
            host_app_id=str(getattr(namespace, "host_app_id", "")),
            output=None if getattr(namespace, "output", None) is None else Path(namespace.output),
            mode=str(getattr(namespace, "mode", "")),
            stream_settings=_stream_settings(getattr(namespace, "stream", None)),
            unset=tuple(getattr(namespace, "unset", None) or ()),
            settings_dir=(
                None
                if getattr(namespace, "settings_dir", None) is None
                else Path(namespace.settings_dir)
            ),
            drm_root=(
                DRM_ROOT
                if getattr(namespace, "drm_root", None) is None
                else Path(namespace.drm_root)
            ),
        )


def main(argv: Sequence[str] | None = None) -> int:
    options = Options.from_namespace(_parse(argv))
    storage = Storage.under(options.runtime_dir, options.settings_dir)
    if options.art_dir is not None:
        storage = replace(storage, art=ArtCache(options.art_dir))
    service = build_sync_service(options.conf, storage)
    return _VERBS[options.command](service, storage, options)


def _refresh(service: SyncService, storage: Storage, _: Options) -> int:
    state = asyncio.run(service.probe_all())
    storage.snapshots.write(state)
    return _print(state.to_json(), fatal=any(error.host_uuid is None for error in state.errors))


def _snapshot(_: SyncService, storage: Storage, __: Options) -> int:
    stored = storage.snapshots.read()
    if stored is None:
        print("no stored snapshot", file=sys.stderr)
        return 1
    return _print(stored.to_json(), fatal=False)


def _print(document: JsonObject, *, fatal: bool) -> int:
    json.dump(document, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 1 if fatal else 0


def _art(service: SyncService, _: Storage, options: Options) -> int:
    payload = service.art(options.host_uuid, options.host_app_id)
    if payload is None:
        print(f"no capsule for {options.host_uuid}/{options.host_app_id}", file=sys.stderr)
        return 1
    if options.output is None:
        print(f"{len(payload)} bytes")
    else:
        options.output.write_bytes(payload)
        print(f"wrote {len(payload)} bytes to {options.output}")
    return 0


def _settings(_: SyncService, storage: Storage, options: Options) -> int:
    store = storage.settings
    if options.mode != "":
        store.set_presentation_mode(options.mode)
    if options.stream_settings or options.unset:
        merged = {**store.read().stream_settings, **options.stream_settings}
        for key in options.unset:
            merged.pop(key, None)
        store.set_stream_settings(merged)
    return _print(store.read().to_json(), fatal=False)


def _display(_: SyncService, __: Storage, options: Options) -> int:
    """An undetected display is a verdict the panel acts on, so it is not a failure here."""
    return _print(DisplayProbe(options.drm_root).capabilities().to_json(), fatal=False)


def _purge(service: SyncService, _: Storage, __: Options) -> int:
    service.purge()
    print("removed the art cache, the stored snapshot, the settings and the client identity")
    return 0


_VERBS: Final[dict[str, Callable[[SyncService, Storage, Options], int]]] = {
    "refresh": _refresh,
    "snapshot": _snapshot,
    "art": _art,
    "settings": _settings,
    "display": _display,
    "purge": _purge,
}


def _stream_settings(pairs: object) -> dict[str, str | float]:
    """`KEY=VALUE`, with a numeric value stored as a number so sliders round-trip."""
    settings: dict[str, str | float] = {}
    for pair in pairs if isinstance(pairs, list) else []:
        key, separator, raw = str(pair).partition("=")
        if separator == "":
            message = f"Expected KEY=VALUE, got {pair!r}"
            raise ValueError(message)
        try:
            settings[key] = float(raw)
        except ValueError:
            settings[key] = raw
    return settings


def _parse(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="perigee")
    subparsers = parser.add_subparsers(dest="command", required=True)

    for verb, help_text in (
        ("refresh", "probe every host at once, store the result and print it"),
        ("snapshot", "print the stored probe result without touching the network"),
        ("art", "print or write one cached capsule, fetching it on a miss"),
        ("settings", "print the stored settings, or set the presentation mode"),
        ("display", "print what the connected display reports through its EDID"),
        ("purge", "delete the art cache, snapshot, settings and client identity"),
    ):
        subparser = subparsers.add_parser(verb, help=help_text)
        subparser.add_argument("--conf", type=Path, default=moonlight_config_path(Path.home()))
        subparser.add_argument("--runtime-dir", type=Path, default=_DEFAULT_RUNTIME_DIR)
        subparser.add_argument("--art-dir", type=Path, default=None)
        subparser.add_argument(
            "--settings-dir",
            type=Path,
            default=None,
            help="where the plugin keeps its settings; defaults to the runtime dir",
        )
        if verb == "art":
            subparser.add_argument("--host-uuid", required=True)
            subparser.add_argument("--host-app-id", required=True)
            subparser.add_argument("--output", type=Path, default=None)
        if verb == "display":
            subparser.add_argument(
                "--drm-root",
                type=Path,
                default=DRM_ROOT,
                help="where the kernel exposes the DRM connectors",
            )
        if verb == "settings":
            subparser.add_argument("--presentation-mode", dest="mode", default="")
            subparser.add_argument(
                "--stream",
                action="append",
                metavar="KEY=VALUE",
                help="set one streaming setting; repeatable, numbers are stored as numbers",
            )
            subparser.add_argument(
                "--unset",
                action="append",
                metavar="KEY",
                help="return one streaming setting to inherit; repeatable",
            )

    return parser.parse_args(argv)
