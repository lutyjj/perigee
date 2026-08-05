from __future__ import annotations

from typing import Final

import pytest
from synthetic_edid import QHD_120, UHD_60, base_block, checksummed, cta_block, edid, timing

from perigee.edid import BLOCK_SIZE, DisplayMode, EdidError, parse_modes


def _broken_checksum(document: bytes) -> bytes:
    """Nudges the block's own checksum byte, so the block can no longer sum to zero."""
    return document[:-1] + bytes([(document[-1] + 1) % 256])


UHD_60_MODE: Final = DisplayMode(width=3840, height=2160, refresh_hz=60.0)
QHD_120_MODE: Final = DisplayMode(width=2560, height=1440, refresh_hz=119.998)


def test_reads_the_base_block_detailed_timings() -> None:
    modes = parse_modes(edid(UHD_60, QHD_120))

    assert modes == (
        DisplayMode(width=3840, height=2160, refresh_hz=60.0),
        DisplayMode(width=2560, height=1440, refresh_hz=119.998),
    )


def test_reads_all_four_base_descriptor_slots() -> None:
    assert len(parse_modes(edid(UHD_60, QHD_120, UHD_60, QHD_120))) == 4


def test_reads_the_extension_timings_from_the_offset_it_declares() -> None:
    document = edid(UHD_60, extension=cta_block(QHD_120, start=20))

    assert parse_modes(document) == (UHD_60_MODE, QHD_120_MODE)


@pytest.mark.parametrize("start", [0, 1])
def test_an_extension_declaring_no_timings_contributes_none(start: int) -> None:
    document = edid(UHD_60, extension=cta_block(QHD_120, start=start))

    assert parse_modes(document) == (UHD_60_MODE,)


def test_an_extension_with_no_room_for_a_timing_contributes_none() -> None:
    # A start of 112 leaves fewer than 18 bytes before the checksum.
    document = edid(UHD_60, extension=cta_block(start=112))

    assert parse_modes(document) == (UHD_60_MODE,)


def test_an_extension_that_is_not_cta_contributes_none() -> None:
    other = checksummed(bytes([0xF0]) + bytes(BLOCK_SIZE - 2))

    assert parse_modes(base_block(UHD_60, extensions=1) + other) == (UHD_60_MODE,)


def test_a_zero_pixel_clock_is_a_display_descriptor_not_a_timing() -> None:
    assert parse_modes(edid(bytes(18), UHD_60)) == (UHD_60_MODE,)


def test_extension_timings_stop_at_the_first_padding_descriptor() -> None:
    document = edid(UHD_60, extension=cta_block(QHD_120, bytes(18), UHD_60))

    assert parse_modes(document) == (UHD_60_MODE, QHD_120_MODE)


def test_a_timing_with_no_pixels_is_ignored() -> None:
    degenerate = timing(pixel_clock=10000, hactive=0, hblank=0, vactive=0, vblank=0)

    assert parse_modes(edid(degenerate)) == ()


def test_an_edid_with_no_detailed_timings_reads_as_no_modes() -> None:
    assert parse_modes(edid()) == ()


@pytest.mark.parametrize(
    ("document", "reason"),
    [
        (b"", "whole"),
        (bytes(64), "whole"),
        (edid(UHD_60)[:-1], "whole"),
        (edid(UHD_60)[1:] + b"\x00", "header"),
        (bytes(BLOCK_SIZE), "header"),
        (_broken_checksum(edid(UHD_60)), "checksum"),
        (_broken_checksum(edid(UHD_60, extension=cta_block(QHD_120))), "checksum"),
    ],
)
def test_malformed_input_raises_rather_than_guessing(document: bytes, reason: str) -> None:
    with pytest.raises(EdidError, match=reason):
        parse_modes(document)
