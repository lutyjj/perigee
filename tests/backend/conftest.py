from __future__ import annotations

from pathlib import Path

import pytest

_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


@pytest.fixture
def fixtures() -> Path:
    return _FIXTURES
