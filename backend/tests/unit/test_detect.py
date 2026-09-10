"""File detection — MIME-based grouping."""

from io import BytesIO

import pytest
from PIL import Image

from backend.app.exceptions import FileProcessingError
from backend.app.file_processing.detect import detect_file_group


@pytest.mark.unit
def test_detects_plain_text_from_content():
    assert detect_file_group(b"hello") == "text"


@pytest.mark.unit
def test_detects_png_from_content():
    output = BytesIO()
    Image.new("RGB", (1, 1), "red").save(output, format="PNG")
    assert detect_file_group(output.getvalue()) == "image"


@pytest.mark.unit
def test_rejects_unknown_content() -> None:
    with pytest.raises(FileProcessingError, match="Unsupported file type"):
        detect_file_group(b"\x1f\x8b\x08\x00\x00\x00\x00\x00\x00\x03")
