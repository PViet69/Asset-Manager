"""Boundary-level file processing service tests."""

import pytest

from backend.app.exceptions import FileProcessingError
from backend.app.file_processing.service import process_file


@pytest.mark.unit
def test_rejects_empty_file() -> None:
    with pytest.raises(FileProcessingError, match="Empty file"):
        process_file(b"", "empty.png", "image/png")


@pytest.mark.unit
def test_rejects_file_over_25_mb() -> None:
    content = b"x" * (25 * 1024 * 1024 + 1)
    with pytest.raises(FileProcessingError, match="25 MB"):
        process_file(content, "large.png", "image/png")
