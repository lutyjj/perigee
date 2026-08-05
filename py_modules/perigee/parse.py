from __future__ import annotations

from typing import Any


class JsonReader:
    """The boundary guards every hand-written schema mirror needs, bound to its error type."""

    def __init__(self, error: type[Exception]) -> None:
        self._error = error

    def mapping(self, value: object, what: str) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise self._error(f"Expected an object for {what}")
        return value

    def array(self, value: object, what: str) -> list[Any]:
        if not isinstance(value, list):
            raise self._error(f"Expected an array for {what}")
        return value

    def number(self, value: object, what: str) -> float:
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise self._error(f"Expected a number for {what}")
        return float(value)

    def text(self, value: object, what: str) -> str:
        if not isinstance(value, str):
            raise self._error(f"Expected a string for {what}")
        return value
