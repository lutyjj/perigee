from __future__ import annotations

from dataclasses import dataclass
from typing import Final, NamedTuple

BLOCK_SIZE: Final = 128

_HEADER: Final = b"\x00\xff\xff\xff\xff\xff\xff\x00"
_BASE_TIMING_OFFSETS: Final = (54, 72, 90, 108)
_TIMING_SIZE: Final = 18
_CTA_TAG: Final = 0x02
# Byte 2 of a CTA block is where its detailed timings start; 0 and 1 are the two
# ways it says it carries none.
_CTA_TIMING_START: Final = 2
_CTA_FIRST_TIMING: Final = 4
_PIXEL_CLOCK_HZ: Final = 10_000
_REFRESH_DECIMALS: Final = 3


class EdidError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class DisplayMode:
    width: int
    height: int
    refresh_hz: float


def parse_modes(data: bytes) -> tuple[DisplayMode, ...]:
    """The detailed timings of the base block and of every CTA-861 extension."""
    if len(data) < BLOCK_SIZE or len(data) % BLOCK_SIZE != 0:
        raise EdidError(f"An EDID is whole {BLOCK_SIZE}-byte blocks, this is {len(data)}")
    if data[: len(_HEADER)] != _HEADER:
        raise EdidError("The EDID header is missing")
    for index in range(0, len(data), BLOCK_SIZE):
        if sum(data[index : index + BLOCK_SIZE]) % 256 != 0:
            raise EdidError(f"Block {index // BLOCK_SIZE} fails its checksum")

    modes: list[DisplayMode] = []
    for offset in _BASE_TIMING_OFFSETS:
        mode = _timing(data[offset : offset + _TIMING_SIZE])
        if mode is not None:
            modes.append(mode)
    for start in range(BLOCK_SIZE, len(data), BLOCK_SIZE):
        modes.extend(_extension_timings(data[start : start + BLOCK_SIZE]))
    return tuple(modes)


def _extension_timings(block: bytes) -> list[DisplayMode]:
    if block[0] != _CTA_TAG:
        return []
    start = block[_CTA_TIMING_START]
    if start < _CTA_FIRST_TIMING:
        return []
    modes: list[DisplayMode] = []
    # The last byte is the checksum, so a timing has to end before it.
    for offset in range(start, BLOCK_SIZE - _TIMING_SIZE, _TIMING_SIZE):
        mode = _timing(block[offset : offset + _TIMING_SIZE])
        if mode is None:
            break
        modes.append(mode)
    return modes


class _Dimension(NamedTuple):
    active: int
    total: int


def _timing(descriptor: bytes) -> DisplayMode | None:
    pixel_clock = descriptor[0] | (descriptor[1] << 8)
    if pixel_clock == 0:
        # A zero pixel clock marks a display descriptor, not a timing.
        return None
    horizontal = _dimension(descriptor[2], descriptor[3], descriptor[4])
    vertical = _dimension(descriptor[5], descriptor[6], descriptor[7])
    pixels = horizontal.total * vertical.total
    if pixels == 0:
        return None
    refresh = pixel_clock * _PIXEL_CLOCK_HZ / pixels
    return DisplayMode(
        width=horizontal.active,
        height=vertical.active,
        refresh_hz=round(refresh, _REFRESH_DECIMALS),
    )


def _dimension(active_low: int, blank_low: int, high: int) -> _Dimension:
    """Each dimension is ten bits, split as a low byte plus a nibble of a shared byte."""
    active = active_low | ((high & 0xF0) << 4)
    blank = blank_low | ((high & 0x0F) << 8)
    return _Dimension(active=active, total=active + blank)
