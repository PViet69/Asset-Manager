"""Image validation utilities."""

from io import BytesIO

from PIL import Image

from backend.app.exceptions import FileProcessingError

MAX_IMAGE_PIXELS = 100_000_000


def validate_image(content: bytes) -> None:
    """Validate that bytes represent a parseable image.

    Raises:
        FileProcessingError: if image bytes are corrupt.
    """
    try:
        with Image.open(BytesIO(content)) as img:
            if img.width * img.height > MAX_IMAGE_PIXELS:
                raise FileProcessingError("Image exceeds safe pixel limit")
            img.verify()
    except FileProcessingError:
        raise
    except Exception as exc:
        raise FileProcessingError("Invalid image") from exc
