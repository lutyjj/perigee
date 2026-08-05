from __future__ import annotations

import http.client
import re
import ssl
import urllib.parse
from dataclasses import dataclass
from typing import TYPE_CHECKING, Final, Protocol

from perigee import xmltree

if TYPE_CHECKING:
    from perigee.config import ClientIdentity, PairedHost
    from perigee.identity import IdentityStore

HTTPS_PORT: Final = 47984
REQUEST_TIMEOUT_SECONDS: Final = 5.0
MAX_ASSET_BYTES: Final = 8 << 20
_OK_STATUS: Final = "200"
# Must survive being a cache path segment; ArtCache applies the same rule.
_APP_ID = re.compile(r"^[A-Za-z0-9._-]+$")
# Moonshine answers a gated endpoint with this status when the client certificate
# is not a paired one; it is a normal HTTP response, not a TLS failure.
_UNAUTHORIZED_STATUS: Final = "401"


class GameStreamError(Exception):
    pass


class HostUnreachable(GameStreamError):  # noqa: N818
    pass


class ProtocolError(GameStreamError):
    pass


class PairingRejected(GameStreamError):  # noqa: N818
    """The host answered but refused the client certificate: Moonlight must pair again.

    Raised for the two shapes that carry that meaning unambiguously: a `401` status
    from a gated endpoint, and a TLS handshake the peer failed over the certificate.
    A bare connection reset is deliberately NOT one of them - it carries no evidence
    distinguishing a refused certificate from a host that went away, and telling a
    user to re-pair a sleeping machine is worse than saying it is offline.
    """


@dataclass(frozen=True, slots=True)
class HostInfo:
    unique_id: str
    hostname: str


@dataclass(frozen=True, slots=True)
class GameStreamApp:
    host_app_id: str
    title: str


class GameStreamApi(Protocol):
    def server_info(self) -> HostInfo: ...
    def app_list(self) -> tuple[GameStreamApp, ...]: ...
    def app_asset(self, host_app_id: str) -> bytes: ...


class GameStreamClient(GameStreamApi):
    def __init__(
        self,
        address: str,
        ssl_context: ssl.SSLContext,
        port: int = HTTPS_PORT,
        timeout: float = REQUEST_TIMEOUT_SECONDS,
    ) -> None:
        self._address = address
        self._ssl_context = ssl_context
        self._port = port
        self._timeout = timeout

    def server_info(self) -> HostInfo:
        root = self._get_xml("/serverinfo")
        return HostInfo(
            unique_id=_required_text(root, "uniqueid"),
            hostname=_required_text(root, "hostname"),
        )

    def app_list(self) -> tuple[GameStreamApp, ...]:
        root = self._get_xml("/applist")
        return tuple(
            GameStreamApp(
                host_app_id=_safe_app_id(_required_text(node, "ID")),
                title=_required_text(node, "AppTitle"),
            )
            for node in root.findall("App")
        )

    def app_asset(self, host_app_id: str) -> bytes:
        return self._get("/appasset", {"appid": host_app_id}, limit=MAX_ASSET_BYTES)

    def _get_xml(self, path: str) -> xmltree.XmlElement:
        payload = self._get(path, {}, limit=xmltree.MAX_DOCUMENT_BYTES)
        try:
            root = xmltree.parse(payload)
        except xmltree.XmlParseError as error:
            raise ProtocolError(f"{path} returned malformed XML: {error}") from error
        status = root.get("status_code")
        message = root.get("status_message", "no status message")
        if status == _UNAUTHORIZED_STATUS:
            raise PairingRejected(f"{path} refused this client: {message}")
        if status != _OK_STATUS:
            raise ProtocolError(f"{path} returned status {status!r}: {message}")
        return root

    def _get(self, path: str, params: dict[str, str], limit: int) -> bytes:
        url = f"{path}?{urllib.parse.urlencode(params)}" if params else path
        connection = http.client.HTTPSConnection(
            self._address,
            self._port,
            context=self._ssl_context,
            timeout=self._timeout,
        )
        try:
            connection.request("GET", url)
            response = connection.getresponse()
            # Read one byte past the cap so an oversized body is refused, not truncated.
            payload = response.read(limit + 1)
            if len(payload) > limit:
                raise ProtocolError(f"{path} returned more than {limit} bytes")
            if response.status != http.HTTPStatus.OK:
                raise ProtocolError(f"{path} returned HTTP {response.status}")
        except ssl.SSLError as error:
            message = f"{self._address}:{self._port} rejected the client certificate: {error}"
            raise PairingRejected(message) from error
        except (OSError, http.client.HTTPException) as error:
            message = f"{self._address}:{self._port} did not answer: {error}"
            raise HostUnreachable(message) from error
        finally:
            connection.close()
        return payload


class GameStreamClientFactory:
    def __init__(self, identity_store: IdentityStore) -> None:
        self._identity_store = identity_store

    def __call__(self, host: PairedHost, identity: ClientIdentity) -> GameStreamClient:
        return GameStreamClient(host.address, self._identity_store.ssl_context(identity))


def _safe_app_id(host_app_id: str) -> str:
    """The id becomes a cache path segment, so a hostile one is a protocol error here
    rather than a ValueError from deep inside the probe."""
    if not _APP_ID.match(host_app_id):
        raise ProtocolError(f"Unusable app id from host: {host_app_id!r}")
    return host_app_id


def _required_text(node: xmltree.XmlElement, tag: str) -> str:
    child = node.find(tag)
    if child is None or not child.text:
        raise ProtocolError(f"Missing <{tag}> in response")
    return child.text
