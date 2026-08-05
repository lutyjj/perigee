from __future__ import annotations

import configparser
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from pathlib import Path

_BYTE_ARRAY = re.compile(r'^"?@ByteArray\((.*)\)"?$', re.DOTALL)
_HOST_KEY = re.compile(r"^(?P<index>\d+)\\(?P<field>[a-z]+)$")

_GENERAL_SECTION: Final = "General"
_HOSTS_SECTION: Final = "hosts"
_ESCAPES: Final = {"n": "\n", "t": "\t", "\\": "\\"}

_CONFIG_RELATIVE_PATH: Final = (
    ".var",
    "app",
    "com.moonlight_stream.Moonlight",
    "config",
    "Moonlight Game Streaming Project",
    "Moonlight.conf",
)


def moonlight_config_path(home: Path) -> Path:
    return home.joinpath(*_CONFIG_RELATIVE_PATH)


class MoonlightConfigError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class ClientIdentity:
    """Moonlight's client certificate and private key. Both fields stay out of every repr."""

    cert_pem: str = field(repr=False)
    key_pem: str = field(repr=False)

    def __repr__(self) -> str:
        return "ClientIdentity(<redacted>)"


@dataclass(frozen=True, slots=True)
class PairedHost:
    """`uuid` is canonical lowercase: it is the identity on the wire, in tags and in comparisons."""

    uuid: str
    hostname: str
    address: str


@dataclass(frozen=True, slots=True)
class MoonlightConfig:
    identity: ClientIdentity
    hosts: tuple[PairedHost, ...]


class MoonlightConfigReader:
    def __init__(self, path: Path) -> None:
        self._path = path

    def read(self) -> MoonlightConfig:
        parser = configparser.RawConfigParser(strict=False)
        # QSettings keys are case-sensitive; configparser lowercases them unless this is
        # replaced, and the stdlib types the attribute narrower than the assignment.
        parser.optionxform = str  # type: ignore[method-assign, assignment]
        try:
            with self._path.open(encoding="utf-8") as handle:
                parser.read_file(handle)
        except OSError as error:
            raise MoonlightConfigError(f"Cannot read {self._path}: {error}") from error
        except configparser.Error as error:
            raise MoonlightConfigError(f"Cannot parse {self._path}: {error}") from error

        return MoonlightConfig(identity=self._identity(parser), hosts=self._hosts(parser))

    def _identity(self, parser: configparser.RawConfigParser) -> ClientIdentity:
        if not parser.has_section(_GENERAL_SECTION):
            raise MoonlightConfigError(f"No [{_GENERAL_SECTION}] section in {self._path}")
        general = parser[_GENERAL_SECTION]
        cert = _decode_byte_array(general.get("certificate", ""))
        key = _decode_byte_array(general.get("key", ""))
        if not cert or not key:
            raise MoonlightConfigError(f"No client certificate or key in {self._path}")
        return ClientIdentity(cert_pem=cert, key_pem=key)

    def _hosts(self, parser: configparser.RawConfigParser) -> tuple[PairedHost, ...]:
        if not parser.has_section(_HOSTS_SECTION):
            return ()

        entries: dict[str, dict[str, str]] = {}
        for raw_key, raw_value in parser[_HOSTS_SECTION].items():
            match = _HOST_KEY.match(raw_key)
            if match is not None:
                entries.setdefault(match["index"], {})[match["field"]] = raw_value.strip('"')

        hosts: dict[str, PairedHost] = {}
        for index in sorted(entries, key=int):
            fields = entries[index]
            uuid = fields.get("uuid", "").lower()
            address = fields.get("manualaddress") or fields.get("localaddress") or ""
            if not uuid or not address:
                continue
            host = PairedHost(uuid=uuid, hostname=fields.get("hostname", uuid), address=address)
            hosts.setdefault(host.uuid, host)
        return tuple(hosts.values())


def _decode_byte_array(raw: str) -> str:
    match = _BYTE_ARRAY.match(raw.strip())
    return _unescape(match[1]) if match is not None else ""


def _unescape(raw: str) -> str:
    out: list[str] = []
    index = 0
    while index < len(raw):
        char = raw[index]
        if char == "\\" and index + 1 < len(raw):
            index += 1
            out.append(_ESCAPES.get(raw[index], "\\" + raw[index]))
        else:
            out.append(char)
        index += 1
    return "".join(out)
