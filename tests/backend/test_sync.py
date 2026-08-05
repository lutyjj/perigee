from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import replace
from typing import TYPE_CHECKING

from perigee.art import ArtCache
from perigee.config import ClientIdentity, MoonlightConfigReader, PairedHost
from perigee.gamestream import (
    GameStreamApi,
    GameStreamApp,
    HostInfo,
    HostUnreachable,
    PairingRejected,
    ProtocolError,
)
from perigee.model import SyncState
from perigee.storage import Storage
from perigee.sync import SyncService

if TYPE_CHECKING:
    from pathlib import Path

_MOONSHINE_UUID = "15b43594-35e7-4df6-956b-908ffabb2ef2"
_STALE_UUID = "6ce1ac65-da63-4643-92af-471dda73012c"
_MANUAL_UUID = "11111111-2222-3333-4444-555555555555"

_APPS = (
    GameStreamApp(host_app_id="1", title="Desktop"),
    GameStreamApp(host_app_id="2", title="Steam Big Picture"),
)
_PNG = b"\x89PNG\r\n\x1a\ncapsule"
_SAFE_APP_ID = re.compile(r"^[A-Za-z0-9._-]+$")


class _FakeClient(GameStreamApi):
    def __init__(
        self,
        unique_id: str,
        apps: tuple[GameStreamApp, ...] = (),
        *,
        reachable: bool = True,
        authorized: bool = True,
        applist_fails: bool = False,
        stalls: bool = False,
        assets: frozenset[str] = frozenset(),
    ) -> None:
        self._unique_id = unique_id
        self._apps = apps
        self._reachable = reachable
        self._authorized = authorized
        self._applist_fails = applist_fails
        self._stalls = stalls
        self._assets = assets
        self.asset_requests = 0

    def server_info(self) -> HostInfo:
        if self._stalls:
            time.sleep(PROBE_TIMEOUT_SECONDS * 4)
        if not self._reachable:
            raise HostUnreachable("no route to host")
        if not self._authorized:
            raise PairingRejected("peer rejected the client certificate")
        return HostInfo(unique_id=self._unique_id, hostname="fake")

    def app_list(self) -> tuple[GameStreamApp, ...]:
        if self._applist_fails:
            raise ProtocolError("/applist returned status '401': Not paired")
        for app in self._apps:
            if not _SAFE_APP_ID.match(app.host_app_id):
                raise ProtocolError(f"Unusable app id from host: {app.host_app_id!r}")
        return self._apps

    def app_asset(self, host_app_id: str) -> bytes:
        self.asset_requests += 1
        if host_app_id not in self._assets:
            raise ProtocolError("no boxart defined")
        return _PNG


FIXED_CLOCK = 1750000000.0
# Short enough to keep the suite quick, long enough that a local probe never trips it.
PROBE_TIMEOUT_SECONDS = 0.5


def _service(conf: Path, art_dir: Path, clients: dict[str, _FakeClient]) -> SyncService:
    def factory(host: PairedHost, identity: ClientIdentity) -> GameStreamApi:
        assert identity.cert_pem
        return clients[host.uuid]

    return SyncService(
        MoonlightConfigReader(conf),
        factory,
        replace(Storage.under(art_dir.parent / "runtime"), art=ArtCache(art_dir)),
        clock=lambda: FIXED_CLOCK,
        probe_timeout=PROBE_TIMEOUT_SECONDS,
    )


def _live_clients() -> dict[str, _FakeClient]:
    return {
        _MOONSHINE_UUID: _FakeClient(_MOONSHINE_UUID, _APPS, assets=frozenset({"1"})),
        _STALE_UUID: _FakeClient(_MOONSHINE_UUID),
        _MANUAL_UUID: _FakeClient(_MANUAL_UUID, reachable=False),
    }


def test_state_matches_the_shared_wire_fixture(fixtures: Path, tmp_path: Path) -> None:
    art_dir = tmp_path / "art"
    ArtCache(art_dir).ensure(_MOONSHINE_UUID, "1", lambda: _PNG)

    service = _service(fixtures / "Moonlight.conf", art_dir, _live_clients())

    assert service.state().to_json() == json.loads(
        (fixtures / "sync_state.json").read_text(encoding="utf-8"),
    )


def test_the_fixture_round_trips_through_the_model(fixtures: Path) -> None:
    document = json.loads((fixtures / "sync_state.json").read_text(encoding="utf-8"))

    assert SyncState.from_json(document).to_json() == document


def test_classification_never_blocks_on_box_art(fixtures: Path, tmp_path: Path) -> None:
    clients = _live_clients()

    state = _service(fixtures / "Moonlight.conf", tmp_path / "art", clients).state()
    moonshine = next(host for host in state.hosts if host.uuid == _MOONSHINE_UUID)

    assert clients[_MOONSHINE_UUID].asset_requests == 0
    assert [app.art_cached for app in moonshine.apps] == [False, False]


def test_art_fetches_on_a_miss_and_serves_the_cache_afterwards(
    fixtures: Path,
    tmp_path: Path,
) -> None:
    clients = _live_clients()
    service = _service(fixtures / "Moonlight.conf", tmp_path / "art", clients)

    assert service.art(_MOONSHINE_UUID, "1") == _PNG
    assert service.art(_MOONSHINE_UUID, "1") == _PNG
    assert service.art(_MOONSHINE_UUID, "2") is None
    assert clients[_MOONSHINE_UUID].asset_requests == 2


def test_rejected_client_certificate_is_reported_as_unauthorized(
    fixtures: Path,
    tmp_path: Path,
) -> None:
    clients = _live_clients()
    clients[_MOONSHINE_UUID] = _FakeClient(_MOONSHINE_UUID, _APPS, authorized=False)

    state = _service(fixtures / "Moonlight.conf", tmp_path / "art", clients).state()
    moonshine = next(host for host in state.hosts if host.uuid == _MOONSHINE_UUID)

    assert moonshine.status == "unauthorized"
    assert any("pair it again" in error.message for error in state.errors)


def test_applist_failure_downgrades_the_host_to_offline(fixtures: Path, tmp_path: Path) -> None:
    clients = _live_clients()
    clients[_MOONSHINE_UUID] = _FakeClient(_MOONSHINE_UUID, _APPS, applist_fails=True)

    state = _service(fixtures / "Moonlight.conf", tmp_path / "art", clients).state()
    moonshine = next(host for host in state.hosts if host.uuid == _MOONSHINE_UUID)

    assert moonshine.status == "offline"
    assert moonshine.apps == ()
    assert any(error.host_uuid == _MOONSHINE_UUID for error in state.errors)


def test_duplicate_titles_collapse_to_one_app_and_report_the_collision(
    fixtures: Path,
    tmp_path: Path,
) -> None:
    doubled = (*_APPS, GameStreamApp(host_app_id="3", title="Desktop"))
    clients = _live_clients()
    clients[_MOONSHINE_UUID] = _FakeClient(_MOONSHINE_UUID, doubled)

    state = _service(fixtures / "Moonlight.conf", tmp_path / "art", clients).state()
    moonshine = next(host for host in state.hosts if host.uuid == _MOONSHINE_UUID)

    assert [app.title for app in moonshine.apps] == ["Desktop", "Steam Big Picture"]
    assert any("twice" in error.message for error in state.errors)


def test_unreadable_config_reports_a_config_level_error(tmp_path: Path) -> None:
    service = _service(tmp_path / "absent.conf", tmp_path / "art", {})

    state = service.state()

    assert state.hosts == ()
    assert [error.host_uuid for error in state.errors] == [None]


def test_probe_all_reports_each_host_as_it_lands(fixtures: Path, tmp_path: Path) -> None:
    service = _service(fixtures / "Moonlight.conf", tmp_path / "art", _live_clients())
    seen: list[str] = []

    state = asyncio.run(service.probe_all(on_host=lambda host: seen.append(host.uuid)))

    assert sorted(seen) == sorted(host.uuid for host in state.hosts)
    assert state.to_json() == service.state().to_json()


def test_probe_all_survives_a_host_that_never_answers(fixtures: Path, tmp_path: Path) -> None:
    clients = _live_clients()
    clients[_MOONSHINE_UUID] = _FakeClient(_MOONSHINE_UUID, _APPS, stalls=True)

    state = asyncio.run(
        _service(fixtures / "Moonlight.conf", tmp_path / "art", clients).probe_all(),
    )
    moonshine = next(host for host in state.hosts if host.uuid == _MOONSHINE_UUID)

    assert moonshine.status == "offline"
    assert len(state.hosts) == 3


def test_one_hosts_malformed_app_id_does_not_take_down_the_refresh(
    fixtures: Path,
    tmp_path: Path,
) -> None:
    """A host id becomes a cache path segment. Uncontained, one host serving `12/../3`
    raises out of the gather and leaves every healthy host status-less."""
    clients = _live_clients()
    clients[_MOONSHINE_UUID] = _FakeClient(
        _MOONSHINE_UUID,
        (GameStreamApp(host_app_id="12/../3", title="Hostile"),),
    )

    state = asyncio.run(
        _service(fixtures / "Moonlight.conf", tmp_path / "art", clients).probe_all(),
    )

    assert len(state.hosts) == 3
    assert {host.status for host in state.hosts} == {"offline", "stale_pairing"}
    assert any(error.host_uuid == _MOONSHINE_UUID for error in state.errors)


def test_a_malformed_app_id_is_rejected_where_the_protocol_is_parsed(
    fixtures: Path,
    tmp_path: Path,
) -> None:
    service = _service(fixtures / "Moonlight.conf", tmp_path / "art", _live_clients())

    assert service.art(_MOONSHINE_UUID, "12/../3") is None
    assert service.art("..", "1") is None
