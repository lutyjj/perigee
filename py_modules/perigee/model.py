from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final, Literal, get_args

from perigee.parse import JsonReader

SYNC_STATE_SCHEMA_VERSION: Final = 3

JsonObject = dict[str, Any]

HostStatus = Literal["online", "offline", "stale_pairing", "unauthorized"]

HOST_STATUSES: Final[tuple[HostStatus, ...]] = get_args(HostStatus)


class SyncStateFormatError(Exception):
    pass


_read = JsonReader(SyncStateFormatError)


@dataclass(frozen=True, slots=True)
class AppEntry:
    host_app_id: str
    title: str
    art_cached: bool

    def to_json(self) -> JsonObject:
        return {
            "host_app_id": self.host_app_id,
            "title": self.title,
            "art_cached": self.art_cached,
        }

    @staticmethod
    def from_json(value: object) -> AppEntry:
        app = _read.mapping(value, "app")
        return AppEntry(
            host_app_id=_read.text(app.get("host_app_id"), "app.host_app_id"),
            title=_read.text(app.get("title"), "app.title"),
            art_cached=app.get("art_cached") is True,
        )


@dataclass(frozen=True, slots=True)
class HostState:
    uuid: str
    name: str
    address: str
    status: HostStatus
    apps: tuple[AppEntry, ...]

    def to_json(self) -> JsonObject:
        return {
            "uuid": self.uuid,
            "name": self.name,
            "address": self.address,
            "status": self.status,
            "apps": [app.to_json() for app in self.apps],
        }

    @staticmethod
    def from_json(value: object) -> HostState:
        host = _read.mapping(value, "host")
        status = host.get("status")
        if status not in HOST_STATUSES:
            raise SyncStateFormatError(f"Unknown host status {status!r}")
        return HostState(
            uuid=_read.text(host.get("uuid"), "host.uuid"),
            name=_read.text(host.get("name"), "host.name"),
            address=_read.text(host.get("address"), "host.address"),
            status=status,
            apps=tuple(
                AppEntry.from_json(app) for app in _read.array(host.get("apps"), "host.apps")
            ),
        )


@dataclass(frozen=True, slots=True)
class SyncError:
    host_uuid: str | None
    message: str

    def to_json(self) -> JsonObject:
        return {"host_uuid": self.host_uuid, "message": self.message}

    @staticmethod
    def from_json(value: object) -> SyncError:
        error = _read.mapping(value, "error")
        host_uuid = error.get("host_uuid")
        return SyncError(
            host_uuid=None if host_uuid is None else _read.text(host_uuid, "error.host_uuid"),
            message=_read.text(error.get("message"), "error.message"),
        )


@dataclass(frozen=True, slots=True)
class SyncState:
    """A probe result and when it was taken, so the panel can render it and say how old it is."""

    captured_at: float
    hosts: tuple[HostState, ...]
    errors: tuple[SyncError, ...]

    def to_json(self) -> JsonObject:
        return {
            "schema_version": SYNC_STATE_SCHEMA_VERSION,
            "captured_at": self.captured_at,
            "hosts": [host.to_json() for host in self.hosts],
            "errors": [error.to_json() for error in self.errors],
        }

    @staticmethod
    def from_json(value: object) -> SyncState:
        root = _read.mapping(value, "sync state")
        version = root.get("schema_version")
        if version != SYNC_STATE_SCHEMA_VERSION:
            raise SyncStateFormatError(
                f"Expected schema {SYNC_STATE_SCHEMA_VERSION}, document declares {version!r}",
            )
        return SyncState(
            captured_at=_read.number(root.get("captured_at"), "captured_at"),
            hosts=tuple(
                HostState.from_json(host) for host in _read.array(root.get("hosts"), "hosts")
            ),
            errors=tuple(
                SyncError.from_json(error) for error in _read.array(root.get("errors"), "errors")
            ),
        )
