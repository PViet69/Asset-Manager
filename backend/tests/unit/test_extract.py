"""Image validation tests."""

from io import BytesIO

import pytest
from PIL import Image

from backend.app.exceptions import FileProcessingError
from backend.app.file_processing.extract import validate_image


@pytest.mark.unit
def test_validates_image_bytes():
    output = BytesIO()
    Image.new("RGB", (1, 1), "blue").save(output, format="PNG")
    validate_image(output.getvalue())


@pytest.mark.unit
def test_rejects_invalid_image_bytes():
    with pytest.raises(FileProcessingError, match="image"):
        validate_image(b"not image bytes")
