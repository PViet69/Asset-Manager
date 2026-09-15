"""Service-level file processing orchestration."""

from backend.app.exceptions import FileProcessingError
from backend.app.file_processing.detect import detect_file_group
from backend.app.file_processing.extract import validate_image
from backend.app.file_processing.types import FileGroup, ProcessedInput

# 25 MB limit
MAX_FILE_SIZE = 25 * 1024 * 1024


def process_file(content: bytes, filename: str, content_type: str) -> ProcessedInput:
    """Validate supported image bytes for embedding.

    Filename and submitted content type provide context only; byte inspection
    determines whether content is supported.
    """
    del filename, content_type
    if not content:
        raise FileProcessingError("Empty file")

    if len(content) > MAX_FILE_SIZE:
        raise FileProcessingError("File exceeds 25 MB limit")

    group: FileGroup = detect_file_group(content)
    if group != "image":
        raise FileProcessingError("Unsupported file type")

    validate_image(content)
    return ProcessedInput(kind="image", value=content)
