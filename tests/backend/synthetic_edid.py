"""Builds EDID bytes for the tests, so no capture of anyone's real display is needed."""

from __future__ import annotations

from typing import Final

from perigee.edid import BLOCK_SIZE

HEADER: Final = b"\x00\xff\xff\xff\xff\xff\xff\x00"
TIMING_SIZE: Final = 18
FIRST_TIMING_OFFSET: Final = 54
TIMINGS_PER_BLOCK: Final = 4
EXTENSION_COUNT_BYTE: Final = 126
CTA_TAG: Final = 0x02
CTA_FIRST_TIMING: Final = 4


def timing(*, pixel_clock: int, hactive: int, hblank: int, vactive: int, vblank: int) -> bytes:
    """One 18-byte detailed timing descriptor. The pixel clock is in 10 kHz units."""
    return bytes(
        [
            pixel_clock & 0xFF,
            (pixel_clock >> 8) & 0xFF,
            hactive & 0xFF,
            hblank & 0xFF,
            ((hactive >> 4) & 0xF0) | ((hblank >> 8) & 0x0F),
            vactive & 0xFF,
            vblank & 0xFF,
            ((vactive >> 4) & 0xF0) | ((vblank >> 8) & 0x0F),
        ],
    ) + bytes(TIMING_SIZE - 8)


# 3840x2160 at 60 Hz and 2560x1440 at 120 Hz, as CTA-861 specifies their timings.
UHD_60: Final = timing(pixel_clock=59400, hactive=3840, hblank=560, vactive=2160, vblank=90)
QHD_120: Final = timing(pixel_clock=49775, hactive=2560, hblank=160, vactive=1440, vblank=85)


def base_block(*timings: bytes, extensions: int = 0) -> bytes:
    block = bytearray(HEADER) + bytes(FIRST_TIMING_OFFSET - len(HEADER))
    for index in range(TIMINGS_PER_BLOCK):
        block += timings[index] if index < len(timings) else bytes(TIMING_SIZE)
    block.append(extensions)
    return checksummed(block)


def cta_block(*timings: bytes, start: int = CTA_FIRST_TIMING) -> bytes:
    block = bytearray([CTA_TAG, 0x03, start, 0x00])
    block += bytes(max(start - len(block), 0))
    for entry in timings:
        block += entry
    return checksummed(block + bytes(BLOCK_SIZE - 1 - len(block)))


def edid(*timings: bytes, extension: bytes | None = None) -> bytes:
    if extension is None:
        return base_block(*timings)
    return base_block(*timings, extensions=1) + extension


def checksummed(block: bytearray | bytes) -> bytes:
    """Appends the byte that makes the block sum to zero, which is what the parser checks."""
    body = bytes(block)
    return body + bytes([(-sum(body)) % 256])
