"""File group detection based on MIME content inspection."""

import threading

import magic

from backend.app.exceptions import FileProcessingError
from backend.app.file_processing.types import FileGroup

_MAGIC_LOCK = threading.Lock()

# MIME type mapping to file groups
_TEXT_MIME_PREFIXES = (
    "text/",
    "application/json",
    "application/xml",
    "text/yaml",
    "text/x-yaml",
)

_IMAGE_MIME_SUBSTRINGS = (
    "image/png",
    "image/jpeg",
    "image/webp",
)

_PDF_MIME = "application/pdf"


def detect_file_group(content: bytes) -> FileGroup:
    """Detect file group from raw bytes using MIME content inspection.

    Uses python-magic to inspect content and map to text, image, pdf.

    Raises:
        FileProcessingError: if MIME type is unsupported.
    """
    if not content:
        raise FileProcessingError("Empty file")

    if content.startswith(b"%PDF-"):
        return "pdf"

    if (
        content.startswith(b"\xff\xd8\xff")
        or content.startswith(b"\x89PNG\r\n\x1a\n")
        or (content.startswith(b"RIFF") and content[8:12] == b"WEBP")
    ):
        return "image"

    with _MAGIC_LOCK:
        mime = magic.from_buffer(content, mime=True)

    if mime == _PDF_MIME:
        return "pdf"

    if any(mime.startswith(prefix) for prefix in _TEXT_MIME_PREFIXES):
        return "text"

    if any(mime_sub in mime for mime_sub in _IMAGE_MIME_SUBSTRINGS):
        return "image"

    raise FileProcessingError("Unsupported file type")
