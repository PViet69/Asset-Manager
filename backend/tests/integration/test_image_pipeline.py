"""HTTP image-description pipeline integration tests."""

import os
from pathlib import Path

import pytest

from backend.app.exceptions import ModelEndpointError
from backend.app.model.description_client import (
    InstructorAssetDescriptionClient,
)
from backend.app.model.prompt_model import ImageDescription
from openai import OpenAI

REPO_ROOT = Path(__file__).parents[3]
SMALL_PNG_PATH = REPO_ROOT / "backend" / "tests" / "fixtures" / "small.png"


def _model_endpoint_url() -> str | None:
    value = os.environ.get("MODEL_ENDPOINT_URL")
    if value:
        return value
    env_file = REPO_ROOT / ".env"
    if not env_file.exists():
        return None
    for raw_line in env_file.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("MODEL_ENDPOINT_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


@pytest.fixture
def model_endpoint_url() -> str:
    url = _model_endpoint_url()
    if url is None:
        pytest.skip("MODEL_ENDPOINT_URL not configured")
    return url


@pytest.fixture
def description_model_name() -> str:
    name = os.environ.get("DESCRIPTION_MODEL")
    if not name:
        pytest.skip("DESCRIPTION_MODEL not configured")
    return name


@pytest.fixture
def small_png_bytes() -> bytes:
    if not SMALL_PNG_PATH.exists():
        pytest.skip(f"Missing test fixture {SMALL_PNG_PATH}")
    return SMALL_PNG_PATH.read_bytes()


@pytest.mark.integration
def test_real_image_description_produces_validated_structured_output(
    model_endpoint_url: str,
    description_model_name: str,
    small_png_bytes: bytes,
) -> None:
    client = InstructorAssetDescriptionClient.from_client(
        OpenAI(
            base_url=model_endpoint_url,
            api_key=os.environ.get("MODEL_ENDPOINT_API_KEY") or "not-needed",
            timeout=60,
        ),
        description_model=description_model_name,
    )

    description = client.describe(small_png_bytes)

    assert isinstance(description, ImageDescription)

    text = description.to_embedding_text()
    assert text.startswith("Subjects:")
    assert "Search keywords:" in text


@pytest.mark.integration
def test_real_image_description_health_reports_configured_model_availability(
    model_endpoint_url: str,
    description_model_name: str,
) -> None:
    client = InstructorAssetDescriptionClient.from_client(
        OpenAI(
            base_url=model_endpoint_url,
            api_key=os.environ.get("MODEL_ENDPOINT_API_KEY") or "not-needed",
            timeout=60,
        ),
        description_model=description_model_name,
    )

    status = client.check_health()

    assert status in {"ok", "unavailable"}


@pytest.mark.integration
def test_real_image_description_rejects_non_image_bytes(
    model_endpoint_url: str,
    description_model_name: str,
) -> None:
    client = InstructorAssetDescriptionClient.from_client(
        OpenAI(
            base_url=model_endpoint_url,
            api_key=os.environ.get("MODEL_ENDPOINT_API_KEY") or "not-needed",
            timeout=60,
        ),
        description_model=description_model_name,
    )

    with pytest.raises(ModelEndpointError, match="Unsupported image format"):
        client.describe(b"definitely-not-an-image")
