import logging
from unittest.mock import Mock, patch

import httpx
import instructor
import pytest
from instructor.core.exceptions import InstructorRetryException
from openai import APITimeoutError, BadRequestError

from backend.app.exceptions import ModelEndpointError
from backend.app.model.description_client import InstructorImageDescriptionClient
from backend.app.model.prompt_model import ImageDescription


def make_description() -> ImageDescription:
    return ImageDescription(
        subjects=("human",),
        attributes=("green eyes",),
        actions=("looking",),
        setting=("outdoor",),
        colors=("green",),
        style=("photo",),
        visible_text=(),
    )


@pytest.mark.unit
def test_describe_returns_validated_image_description() -> None:
    sdk = Mock()
    structured_client = Mock()
    expected = make_description()
    structured_client.chat.completions.create.return_value = expected

    with (
        patch(
            "backend.app.model.description_client.instructor.patch",
            return_value=structured_client,
        ) as patch_client,
        patch(
            "backend.app.model.description_client.magic.from_buffer",
            return_value="image/png",
        ),
    ):
        client = InstructorImageDescriptionClient.from_client(
            sdk,
            description_model="vision-model",
        )
        result = client.describe(b"valid-png-bytes")

    assert result == expected
    patch_client.assert_called_once_with(sdk, mode=instructor.Mode.JSON)


@pytest.mark.unit
def test_describe_rejects_unsupported_detected_image_type() -> None:
    sdk = Mock()
    structured_client = Mock()

    with (
        patch(
            "backend.app.model.description_client.instructor.patch",
            return_value=structured_client,
        ),
        patch(
            "backend.app.model.description_client.magic.from_buffer",
            return_value="image/gif",
        ),
    ):
        client = InstructorImageDescriptionClient.from_client(
            sdk,
            description_model="vision-model",
        )

        with pytest.raises(ModelEndpointError, match="Unsupported image format"):
            client.describe(b"gif-bytes")

    structured_client.chat.completions.create.assert_not_called()


@pytest.mark.unit
def test_description_timeout_becomes_safe_domain_error() -> None:
    sdk = Mock()
    structured_client = Mock()
    structured_client.chat.completions.create.side_effect = APITimeoutError(
        request=httpx.Request("POST", "https://model.example/chat/completions")
    )

    with (
        patch(
            "backend.app.model.description_client.instructor.patch",
            return_value=structured_client,
        ),
        patch(
            "backend.app.model.description_client.magic.from_buffer",
            return_value="image/jpeg",
        ),
    ):
        client = InstructorImageDescriptionClient.from_client(
            sdk,
            description_model="vision-model",
        )

        with pytest.raises(ModelEndpointError) as exc_info:
            client.describe(b"jpeg-bytes")

    assert exc_info.value.safe_message == "Model endpoint timed out"
    assert "model.example" not in exc_info.value.safe_message


def _describe_with_error(caplog: pytest.LogCaptureFixture, exc: Exception) -> None:
    sdk = Mock()
    structured_client = Mock()
    structured_client.chat.completions.create.side_effect = exc

    with (
        patch(
            "backend.app.model.description_client.instructor.patch",
            return_value=structured_client,
        ),
        patch(
            "backend.app.model.description_client.magic.from_buffer",
            return_value="image/jpeg",
        ),
    ):
        client = InstructorImageDescriptionClient.from_client(
            sdk,
            description_model="vision-model",
        )

        with pytest.raises(ModelEndpointError):
            client.describe(b"jpeg-bytes")


@pytest.mark.unit
def test_description_failure_logs_cause_details(
    caplog: pytest.LogCaptureFixture,
) -> None:
    error = BadRequestError(
        message="unsupported image encoding",
        response=httpx.Response(
            400,
            request=httpx.Request("POST", "https://model.example/v1/chat/completions"),
        ),
        body={"error": {"message": "unsupported image encoding"}},
    )
    with caplog.at_level(logging.ERROR, logger="backend.app.model.description_client"):
        _describe_with_error(caplog, error)

    assert any(
        "unsupported image encoding" in record.getMessage() for record in caplog.records
    )


@pytest.mark.unit
def test_description_retry_failure_logs_cause_details(
    caplog: pytest.LogCaptureFixture,
) -> None:
    error = InstructorRetryException(
        "invalid JSON: missing closing brace",
        n_attempts=2,
        total_usage=0,
        last_completion='```json\n{"summary": "broken"',
    )
    with caplog.at_level(logging.ERROR, logger="backend.app.model.description_client"):
        _describe_with_error(caplog, error)

    assert any(
        "missing closing brace" in record.getMessage() for record in caplog.records
    )


@pytest.mark.unit
def test_description_client_exposes_configured_model_name_only() -> None:
    sdk = Mock()

    with patch(
        "backend.app.model.description_client.instructor.patch",
        return_value=Mock(),
    ):
        client = InstructorImageDescriptionClient.from_client(
            sdk,
            description_model="vision-model",
        )

    assert client.model_name == "vision-model"
    assert not hasattr(client, "endpoint_url")
    assert not hasattr(client, "endpoint_api_key")


@pytest.mark.unit
def test_description_health_requires_configured_model() -> None:
    sdk = Mock()
    sdk.models.list.return_value.data = [Mock(id="another-model")]

    with patch(
        "backend.app.model.description_client.instructor.patch",
        return_value=Mock(),
    ):
        client = InstructorImageDescriptionClient.from_client(
            sdk,
            description_model="vision-model",
        )

    assert client.check_health() == "unavailable"
    sdk.models.list.assert_called_once_with()


@pytest.mark.unit
def test_description_health_is_ok_when_configured_model_exists() -> None:
    sdk = Mock()
    sdk.models.list.return_value.data = [Mock(id="vision-model")]

    with patch(
        "backend.app.model.description_client.instructor.patch",
        return_value=Mock(),
    ):
        client = InstructorImageDescriptionClient.from_client(
            sdk,
            description_model="vision-model",
        )

    assert client.check_health() == "ok"
