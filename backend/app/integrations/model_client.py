"""OpenAI-compatible adapter for configured text embeddings."""

import logging
import threading
import time
from typing import Protocol

from openai import APIConnectionError, APIError, APITimeoutError, NotFoundError, OpenAI

from backend.app.config import Settings
from backend.app.exceptions import ModelEndpointError, ModelNotFoundError

logger = logging.getLogger(__name__)

GLOBAL_MODEL_LOCK = threading.Lock()


class ModelClient(Protocol):
    """Boundary for one configured text embedding model."""

    @property
    def model_name(self) -> str: ...

    def embed_text(self, text: str) -> list[float]: ...
    def check_health(self) -> str: ...


class OpenAICompatibleModelClient:
    """Text embedding adapter backed by an OpenAI-compatible endpoint."""

    def __init__(self, settings: Settings) -> None:
        self._client = OpenAI(
            base_url=settings.MODEL_ENDPOINT_URL,
            api_key=settings.MODEL_ENDPOINT_API_KEY or "not-needed",
            timeout=settings.MODEL_REQUEST_TIMEOUT,
        )
        self._embedding_model = settings.EMBEDDING_MODEL

    @classmethod
    def from_client(
        cls,
        client: OpenAI,
        embedding_model: str,
    ) -> "OpenAICompatibleModelClient":
        """Construct around a pre-built SDK client for isolated tests."""
        instance = cls.__new__(cls)
        instance._client = client
        instance._embedding_model = embedding_model
        return instance

    @property
    def model_name(self) -> str:
        """Return configured embedding model identifier."""
        return self._embedding_model

    def embed_text(self, text: str) -> list[float]:
        """Embed text using configured model and return one numeric vector."""
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                with GLOBAL_MODEL_LOCK:
                    response = self._client.embeddings.create(
                        model=self._embedding_model,
                        input=text,
                    )
                return self._extract_embedding(response)
            except NotFoundError as exc:
                logger.error("Configured embedding model not found")
                raise ModelNotFoundError(exc) from exc
            except (APITimeoutError, APIConnectionError, APIError) as exc:
                last_exc = exc
                logger.warning(
                    "Embedding model attempt %d failed: %s", attempt + 1, exc
                )
                if attempt < 2:
                    time.sleep(1.0 * (attempt + 1))
                    continue

        if last_exc is not None:
            if isinstance(last_exc, APITimeoutError):
                raise ModelEndpointError(
                    "Model endpoint timed out", last_exc
                ) from last_exc
            raise ModelEndpointError(
                "Model endpoint rejected input", last_exc
            ) from last_exc
        raise ModelEndpointError("Model endpoint rejected input")

    def check_health(self) -> str:
        """Check endpoint liveness and configured model availability."""
        try:
            with GLOBAL_MODEL_LOCK:
                response = self._client.models.list()
                model_ids = {
                    item.id
                    for item in getattr(response, "data", ())
                    if isinstance(getattr(item, "id", None), str)
                }
        except Exception:  # noqa: BLE001
            return "unavailable"
        return "ok" if self._embedding_model in model_ids else "unavailable"

    @staticmethod
    def _extract_embedding(response: object) -> list[float]:
        data = getattr(response, "data", ())
        if not data or len(data) != 1:
            raise ModelEndpointError("Model endpoint returned an invalid embedding")

        embedding = getattr(data[0], "embedding", None)
        if (
            not embedding
            or not isinstance(embedding, list)
            or not all(
                isinstance(value, (int, float)) and not isinstance(value, bool)
                for value in embedding
            )
        ):
            raise ModelEndpointError("Model endpoint returned an invalid embedding")
        return list(embedding)
