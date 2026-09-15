"""Type definitions for the file processing module."""

from typing import Literal

FileGroup = Literal["image"]


class ProcessedInput:
    """Immutable representation of processed file input."""

    __slots__ = ("kind", "value")

    kind: Literal["image"]
    value: bytes

    def __init__(self, kind: Literal["image"], value: bytes) -> None:
        object.__setattr__(self, "kind", kind)
        object.__setattr__(self, "value", value)

    def __setattr__(self, name: str, value: object) -> None:
        raise TypeError("ProcessedInput is immutable")

    def __repr__(self) -> str:
        return f"ProcessedInput(kind={self.kind!r}, value={self.value!r})"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, ProcessedInput):
            return NotImplemented
        return self.kind == other.kind and self.value == other.value

    def replace(self, **changes: object) -> "ProcessedInput":
        """Return a new instance with the given changes."""
        current = {"kind": self.kind, "value": self.value}
        current.update(changes)
        return ProcessedInput(
            kind=current["kind"],  # type: ignore[arg-type]
            value=current["value"],
        )
