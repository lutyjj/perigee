from __future__ import annotations

import contextlib
import http.server
import ssl
import threading
import urllib.parse
from typing import TYPE_CHECKING

import pytest

from perigee.config import MoonlightConfigReader
from perigee.gamestream import (
    GameStreamApp,
    GameStreamClient,
    GameStreamError,
    HostUnreachable,
    PairingRejected,
    ProtocolError,
)
from perigee.identity import IdentityStore

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

_NOT_PAIRED = b'<root status_code="401" status_message="Not paired"></root>'
_UNUSED_PORT = 47999


def _handler_class(fixtures: Path, applist: bytes) -> type[http.server.BaseHTTPRequestHandler]:
    payloads = {
        "/serverinfo": ("application/xml", (fixtures / "serverinfo.xml").read_bytes()),
        "/applist": ("application/xml", applist),
        "/appasset": ("image/png", (fixtures / "capsule.png").read_bytes()),
    }

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            pass

        def do_GET(self) -> None:
            path = urllib.parse.urlparse(self.path).path
            content_type, payload = payloads.get(path, ("text/plain", b""))
            self.send_response(200 if payload else 404)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    return Handler


@contextlib.contextmanager
def _serving(
    fixtures: Path,
    applist: bytes,
    verify_mode: ssl.VerifyMode = ssl.CERT_REQUIRED,
) -> Iterator[int]:
    certs = fixtures / "certs"
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(certs / "server.crt"), str(certs / "server.key"))
    context.verify_mode = verify_mode
    context.load_verify_locations(str(certs / "client.crt"))

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _handler_class(fixtures, applist))
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture
def client_context(fixtures: Path, tmp_path: Path) -> ssl.SSLContext:
    identity = MoonlightConfigReader(fixtures / "Moonlight.conf").read().identity
    return IdentityStore(tmp_path / "runtime").ssl_context(identity)


def test_reads_server_info_apps_and_asset(
    fixtures: Path,
    client_context: ssl.SSLContext,
) -> None:
    applist = (fixtures / "applist.xml").read_bytes()
    with _serving(fixtures, applist) as port:
        client = GameStreamClient("127.0.0.1", client_context, port=port)

        assert client.server_info().unique_id == "15b43594-35e7-4df6-956b-908ffabb2ef2"
        assert client.app_list() == (
            GameStreamApp(host_app_id="1", title="Desktop"),
            GameStreamApp(host_app_id="2", title="Steam Big Picture"),
        )
        assert client.app_asset("1").startswith(b"\x89PNG")


def test_an_unpaired_client_is_told_to_pair_again(
    fixtures: Path,
    client_context: ssl.SSLContext,
) -> None:
    """Moonshine answers a gated endpoint with a 401 body rather than failing the TLS
    handshake, so this - not a transport error - is the real unpaired path."""
    with _serving(fixtures, _NOT_PAIRED, verify_mode=ssl.CERT_OPTIONAL) as port:
        client = GameStreamClient("127.0.0.1", client_context, port=port)

        with pytest.raises(PairingRejected, match="Not paired"):
            client.app_list()


def test_a_non_401_error_status_is_a_protocol_error(
    fixtures: Path,
    client_context: ssl.SSLContext,
) -> None:
    body = b'<root status_code="503" status_message="Busy"></root>'
    with _serving(fixtures, body, verify_mode=ssl.CERT_OPTIONAL) as port:
        client = GameStreamClient("127.0.0.1", client_context, port=port)

        with pytest.raises(ProtocolError, match="503"):
            client.app_list()


def test_a_server_that_demands_a_certificate_refuses_a_client_without_one(
    fixtures: Path,
) -> None:
    """The happy-path rig requires the client certificate, so reaching it at all proves
    Perigee presents one. What a bare rejection raises is deliberately not asserted: a
    TLS 1.3 peer may report it as a handshake error or as a reset after it, and only the
    401 body above carries the meaning unambiguously."""
    applist = (fixtures / "applist.xml").read_bytes()
    anonymous = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    anonymous.check_hostname = False
    anonymous.verify_mode = ssl.CERT_NONE

    with _serving(fixtures, applist) as port:
        client = GameStreamClient("127.0.0.1", anonymous, port=port)

        with pytest.raises(GameStreamError):
            client.app_list()


def test_closed_port_is_unreachable(client_context: ssl.SSLContext) -> None:
    client = GameStreamClient("127.0.0.1", client_context, port=_UNUSED_PORT, timeout=1.0)

    with pytest.raises(HostUnreachable):
        client.server_info()
