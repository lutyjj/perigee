from __future__ import annotations

import pytest

from perigee import xmltree

_APPLIST = (
    b'<root status_code="200">'
    b"<App><AppTitle>Desk &amp; Top</AppTitle><ID>1</ID></App>"
    b"<App><AppTitle>Factorio</AppTitle><ID>2</ID></App>"
    b"</root>"
)


def test_reads_attributes_children_and_entities() -> None:
    root = xmltree.parse(_APPLIST)

    apps = root.findall("App")
    identifiers = [child.text for app in apps for child in app.findall("ID")]
    titles = [child.text for app in apps for child in app.findall("AppTitle")]

    assert root.get("status_code") == "200"
    assert identifiers == ["1", "2"]
    assert titles == ["Desk & Top", "Factorio"]


def test_missing_child_reads_as_none() -> None:
    root = xmltree.parse(b'<root status_code="200"></root>')

    assert root.find("App") is None
    assert root.findall("App") == ()


def test_malformed_document_raises() -> None:
    with pytest.raises(xmltree.XmlParseError):
        xmltree.parse(b"<root><unclosed></root>")


def test_rejects_a_document_that_declares_entities() -> None:
    billion_laughs = (
        b'<?xml version="1.0"?><!DOCTYPE root ['
        b'<!ENTITY a "aaaaaaaaaa">'
        b'<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">'
        b'<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">'
        b']><root status_code="200"><App>&c;</App></root>'
    )

    with pytest.raises(xmltree.XmlParseError, match="DTD"):
        xmltree.parse(billion_laughs)


def test_rejects_a_document_over_the_size_cap() -> None:
    oversized = b"<root>" + b"a" * xmltree.MAX_DOCUMENT_BYTES + b"</root>"

    with pytest.raises(xmltree.XmlParseError, match="exceeds"):
        xmltree.parse(oversized)
