"""Structured image descriptions through an OpenAI-compatible endpoint."""

import base64
import logging
import threading
from typing import Protocol

import instructor
import magic
from instructor.core.exceptions import InstructorRetryException
from openai import APIConnectionError, APIError, APITimeoutError, NotFoundError, OpenAI
from pydantic import ValidationError

from backend.app.exceptions import ModelEndpointError, ModelNotFoundError
from backend.app.model.prompt_model import ImageDescription
from backend.app.model.prompts import CAPTIONING_PROMPT

logger = logging.getLogger(__name__)

_MAGIC_LOCK = threading.Lock()
SUPPORTED_IMAGE_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
MAX_DESCRIPTION_RETRIES = 0


class ImageDescriptionClient(Protocol):
    """Boundary for converting validated image bytes into structured text."""

    @property
    def model_name(self) -> str: ...

    def describe(self, image_bytes: bytes) -> ImageDescription: ...
    def check_health(self) -> str: ...


def _failure_detail(exc: Exception) -> str:
    """Extract diagnostic context from description failures for server logs."""
    if isinstance(exc, InstructorRetryException):
        detail = str(exc)
        if getattr(exc, "last_completion", None):
            detail = f"{detail} | last completion: {exc.last_completion!r}"
        return detail
    if isinstance(exc, APIError):
        body = getattr(exc, "body", None)
        if body is not None:
            return f"{exc} | response body: {body!r}"
    return str(exc)


class InstructorImageDescriptionClient:
    """ImageDescriptionClient backed by Instructor and OpenAI SDK."""

    def __init__(
        self,
        endpoint_url: str,
        endpoint_api_key: str | None,
        description_model: str,
        timeout: float,
    ) -> None:
        sdk_client = OpenAI(
            base_url=endpoint_url,
            api_key=endpoint_api_key or "not-needed",
            timeout=timeout,
        )
        self._sdk_client = sdk_client
        self._client = instructor.patch(sdk_client, mode=instructor.Mode.JSON)
        self._description_model = description_model

    @property
    def model_name(self) -> str:
        """Return configured description model identity."""
        return self._description_model

    @classmethod
    def from_client(
        cls,
        client: OpenAI,
        description_model: str,
    ) -> "InstructorImageDescriptionClient":
        """Construct around a pre-built SDK client for isolated tests."""
        instance = cls.__new__(cls)
        instance._sdk_client = client
        instance._client = instructor.patch(client, mode=instructor.Mode.JSON)
        instance._description_model = description_model
        return instance

    def describe(self, image_bytes: bytes) -> ImageDescription:
        """Return validated retrieval fields for supported image bytes."""
        data_url = self._build_data_url(image_bytes)
        try:
            description = self._client.chat.completions.create(
                model=self._description_model,
                response_model=ImageDescription,
                max_retries=MAX_DESCRIPTION_RETRIES,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": CAPTIONING_PROMPT},
                            {
                                "type": "image_url",
                                "image_url": {"url": data_url},
                            },
                        ],
                    }
                ],
            )
        except APITimeoutError as exc:
            logger.error("Model endpoint timed out during image description")
            raise ModelEndpointError("Model endpoint timed out", exc) from exc
        except NotFoundError as exc:
            logger.error("Configured description model not found")
            raise ModelNotFoundError(exc) from exc
        except (
            APIConnectionError,
            APIError,
            InstructorRetryException,
            ValidationError,
        ) as exc:
            logger.error(
                "Model endpoint failed to describe image: %s",
                _failure_detail(exc),
            )
            raise ModelEndpointError(
                "Model endpoint failed to describe image",
                exc,
            ) from exc

        if not isinstance(description, ImageDescription):
            raise ModelEndpointError(
                "Model endpoint returned an invalid image description"
            )
        return description

    def check_health(self) -> str:
        """Check endpoint liveness and configured model availability."""
        try:
            response = self._sdk_client.models.list()
            model_ids = {
                item.id
                for item in getattr(response, "data", ())
                if isinstance(getattr(item, "id", None), str)
            }
        except Exception:  # noqa: BLE001
            return "unavailable"
        return "ok" if self._description_model in model_ids else "unavailable"

    @staticmethod
    def _build_data_url(image_bytes: bytes) -> str:
        mime_type = None
        if image_bytes.startswith(b"\xff\xd8\xff"):
            mime_type = "image/jpeg"
        elif image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            mime_type = "image/png"
        elif image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
            mime_type = "image/webp"
        else:
            with _MAGIC_LOCK:
                mime_type = magic.from_buffer(image_bytes, mime=True)
        if mime_type not in SUPPORTED_IMAGE_MIME_TYPES:
            raise ModelEndpointError("Unsupported image format")
        encoded = base64.b64encode(image_bytes).decode("ascii")
        return f"data:{mime_type};base64,{encoded}"
