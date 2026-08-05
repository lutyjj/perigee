"""Tiny read-only DOM over xml.sax: Decky's frozen runtime ships xml.sax but not xml.etree."""

from __future__ import annotations

import io
import re
import xml.sax
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Final
from xml.sax.handler import ContentHandler, feature_external_ges, feature_external_pes

if TYPE_CHECKING:
    from collections.abc import Mapping
    from xml.sax.xmlreader import AttributesImpl

MAX_DOCUMENT_BYTES: Final = 1 << 20

_DOCTYPE = re.compile(rb"<!DOCTYPE", re.IGNORECASE)


class XmlParseError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class XmlElement:
    tag: str
    attributes: Mapping[str, str]
    text: str
    children: tuple[XmlElement, ...]

    def get(self, name: str, default: str = "") -> str:
        return self.attributes.get(name, default)

    def find(self, tag: str) -> XmlElement | None:
        return next((child for child in self.children if child.tag == tag), None)

    def findall(self, tag: str) -> tuple[XmlElement, ...]:
        return tuple(child for child in self.children if child.tag == tag)


def parse(payload: bytes) -> XmlElement:
    """Parse a GameStream document. Rejects any DTD, so no entity can be declared at all."""
    if len(payload) > MAX_DOCUMENT_BYTES:
        raise XmlParseError(f"document exceeds {MAX_DOCUMENT_BYTES} bytes")
    if _DOCTYPE.search(payload) is not None:
        raise XmlParseError("document declares a DTD")

    builder = _Builder()
    # defusedxml cannot be vendored into the frozen runtime. External entities are
    # switched off here and the DTD check above removes internal entity expansion,
    # which together cover both the retrieval and the amplification attacks.
    parser = xml.sax.make_parser()  # noqa: S317
    for feature in (feature_external_ges, feature_external_pes):
        parser.setFeature(feature, False)  # noqa: FBT003
    parser.setContentHandler(builder)
    try:
        parser.parse(io.BytesIO(payload))
    except (xml.sax.SAXException, ValueError) as error:
        raise XmlParseError(str(error)) from error
    if builder.root is None:
        raise XmlParseError("document has no root element")
    return builder.root


@dataclass(slots=True)
class _Frame:
    tag: str
    attributes: dict[str, str]
    text: list[str] = field(default_factory=list)
    children: list[XmlElement] = field(default_factory=list)


class _Builder(ContentHandler):
    def __init__(self) -> None:
        super().__init__()
        self.root: XmlElement | None = None
        self._stack: list[_Frame] = []

    def startElement(self, name: str, attrs: AttributesImpl) -> None:  # noqa: N802
        self._stack.append(_Frame(tag=name, attributes=dict(attrs.items())))

    def characters(self, content: str) -> None:
        if self._stack:
            self._stack[-1].text.append(content)

    def endElement(self, name: str) -> None:  # noqa: ARG002, N802
        frame = self._stack.pop()
        element = XmlElement(
            tag=frame.tag,
            attributes=frame.attributes,
            text="".join(frame.text),
            children=tuple(frame.children),
        )
        if self._stack:
            self._stack[-1].children.append(element)
        else:
            self.root = element
