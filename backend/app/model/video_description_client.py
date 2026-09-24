"""Structured whole-video descriptions through Google Gen AI Files API."""

import io
import logging
import time
from typing import Any, Protocol

from google import genai
from google.genai import types

from backend.app.exceptions import ModelEndpointError
from backend.app.model.prompt_model import ImageDescription
from backend.app.model.prompts import VIDEO_CAPTIONING_PROMPT

logger = logging.getLogger(__name__)

SUPPORTED_VIDEO_MIME_TYPES = frozenset({"video/mp4", "video/quicktime", "video/webm"})
FILE_READY_TIMEOUT_SECONDS = 120
FILE_READY_POLL_SECONDS = 1


class VideoModelClient(Protocol):
    """Boundary for describing provider-synced video bytes."""

    @property
    def model_name(self) -> str: ...

    def describe(self, content: bytes, mime_type: str) -> ImageDescription: ...


class VideoModelDescriptionClient:
    """Describe temporary Files API video uploads using a configured video model."""

    def __init__(self, api_key: str, model_name: str) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model_name = model_name

    @classmethod
    def from_client(cls, client: Any, model_name: str) -> "VideoModelDescriptionClient":
        """Construct around a pre-built SDK client for isolated tests."""
        instance = cls.__new__(cls)
        instance._client = client
        instance._model_name = model_name
        return instance

    @property
    def model_name(self) -> str:
        """Return configured video-model identity."""
        return self._model_name

    def describe(self, content: bytes, mime_type: str) -> ImageDescription:
        """Upload, describe, and delete a temporary provider video."""
        if mime_type not in SUPPORTED_VIDEO_MIME_TYPES:
            raise ModelEndpointError("Unsupported video format")

        uploaded = None
        try:
            uploaded = self._client.files.upload(
                file=io.BytesIO(content),
                config=types.UploadFileConfig(mime_type=mime_type),
            )
            active_file = self._wait_until_active(str(uploaded.name))
            response = self._client.models.generate_content(
                model=self._model_name,
                contents=[VIDEO_CAPTIONING_PROMPT, active_file],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=ImageDescription,
                ),
            )
            return ImageDescription.model_validate(response.parsed)
        except ModelEndpointError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("Video model analysis failed: %s", type(exc).__name__)
            raise ModelEndpointError("Video model request failed", exc) from exc
        finally:
            if uploaded is not None:
                self._delete_uploaded_file(str(uploaded.name))

    def _wait_until_active(self, name: str) -> Any:
        deadline = time.monotonic() + FILE_READY_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            uploaded = self._client.files.get(name=name)
            state = str(getattr(uploaded, "state", "")).upper()
            if state.endswith("ACTIVE"):
                return uploaded
            if state.endswith("FAILED"):
                raise ModelEndpointError("Video model request failed")
            time.sleep(FILE_READY_POLL_SECONDS)
        raise ModelEndpointError("Video model request failed")

    def _delete_uploaded_file(self, name: str) -> None:
        try:
            self._client.files.delete(name=name)
        except Exception:  # noqa: BLE001
            logger.warning("Video model temporary file cleanup failed")
