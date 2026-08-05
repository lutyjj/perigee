from __future__ import annotations

from pathlib import Path

import pytest

from perigee.config import MoonlightConfigError, MoonlightConfigReader, moonlight_config_path


def test_identity_keeps_key_material_out_of_its_repr(fixtures: Path) -> None:
    config = MoonlightConfigReader(fixtures / "Moonlight.conf").read()

    assert "PRIVATE KEY" not in repr(config)
    assert "PRIVATE KEY" not in repr(config.identity)
    assert "CERTIFICATE" not in repr(config.identity)


def test_reads_client_identity_as_pem(fixtures: Path) -> None:
    identity = MoonlightConfigReader(fixtures / "Moonlight.conf").read().identity

    assert identity.cert_pem.startswith("-----BEGIN CERTIFICATE-----\n")
    assert identity.cert_pem.endswith("-----END CERTIFICATE-----\n")
    assert identity.key_pem.startswith("-----BEGIN PRIVATE KEY-----\n")
    assert identity.key_pem.endswith("-----END PRIVATE KEY-----\n")


def test_lists_addressable_hosts_once_each(fixtures: Path) -> None:
    hosts = MoonlightConfigReader(fixtures / "Moonlight.conf").read().hosts

    assert [(host.hostname, host.address) for host in hosts] == [
        ("stale-pairing-host", "192.0.2.10"),
        ("Moonshine", "192.0.2.10"),
        ("manual-address-host", "198.51.100.9"),
    ]


def test_uuid_is_canonicalised_to_lowercase(fixtures: Path) -> None:
    hosts = MoonlightConfigReader(fixtures / "Moonlight.conf").read().hosts

    assert [host.uuid for host in hosts] == [
        "6ce1ac65-da63-4643-92af-471dda73012c",
        "15b43594-35e7-4df6-956b-908ffabb2ef2",
        "11111111-2222-3333-4444-555555555555",
    ]


def test_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(MoonlightConfigError):
        MoonlightConfigReader(tmp_path / "absent.conf").read()


def test_config_without_identity_raises(tmp_path: Path) -> None:
    conf = tmp_path / "Moonlight.conf"
    conf.write_text("[General]\nfps=60\n", encoding="utf-8")

    with pytest.raises(MoonlightConfigError):
        MoonlightConfigReader(conf).read()


def test_config_path_is_the_flatpak_location() -> None:
    """The path is the flatpak's, relative to whatever home Decky reports."""
    home = Path("/example-home/steamos-user")

    path = moonlight_config_path(home)

    assert path == home / (
        ".var/app/com.moonlight_stream.Moonlight/config"
        "/Moonlight Game Streaming Project/Moonlight.conf"
    )
