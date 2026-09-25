from unittest.mock import Mock

import httpx
import pytest
from openai import APIConnectionError, APIError, APITimeoutError, NotFoundError

from backend.app.exceptions import ModelEndpointError, ModelNotFoundError
from backend.app.integrations.model_client import OpenAICompatibleModelClient


def make_client(sdk: Mock) -> OpenAICompatibleModelClient:
    return OpenAICompatibleModelClient.from_client(
        sdk,
        embedding_model="embedding-model",
    )


@pytest.mark.unit
def test_embed_text_uses_configured_model_and_returns_vector() -> None:
    sdk = Mock()
    sdk.embeddings.create.return_value.data = [Mock(embedding=[0.1, 0.2])]
    client = make_client(sdk)

    assert client.embed_text("hello") == [0.1, 0.2]
    assert client.model_name == "embedding-model"
    sdk.embeddings.create.assert_called_once_with(
        model="embedding-model",
        input="hello",
    )


@pytest.mark.unit
def test_model_timeout_becomes_safe_domain_error() -> None:
    sdk = Mock()
    sdk.embeddings.create.side_effect = APITimeoutError(
        request=httpx.Request("POST", "https://model.example/embeddings")
    )
    client = make_client(sdk)

    with pytest.raises(ModelEndpointError) as exc_info:
        client.embed_text("hello")

    assert exc_info.value.safe_message == "Model endpoint timed out"


@pytest.mark.unit
@pytest.mark.parametrize(
    "error",
    [
        APIConnectionError(
            request=httpx.Request("POST", "https://model.example/embeddings")
        ),
        APIError(
            "secret provider detail",
            request=httpx.Request("POST", "https://model.example/embeddings"),
            body=None,
        ),
    ],
)
def test_model_endpoint_error_becomes_safe_domain_error(error: Exception) -> None:
    sdk = Mock()
    sdk.embeddings.create.side_effect = error
    client = make_client(sdk)

    with pytest.raises(ModelEndpointError) as exc_info:
        client.embed_text("hello")

    assert exc_info.value.safe_message == "Model endpoint rejected input"
    assert "secret provider detail" not in exc_info.value.safe_message


@pytest.mark.unit
@pytest.mark.parametrize(
    "data",
    [
        [],
        [Mock(embedding=[])],
        [Mock(embedding=["not-numeric"])],
        [Mock(embedding=[True])],
    ],
)
def test_embed_text_rejects_invalid_embedding(data: list[object]) -> None:
    sdk = Mock()
    sdk.embeddings.create.return_value.data = data
    client = make_client(sdk)

    with pytest.raises(ModelEndpointError, match="invalid embedding"):
        client.embed_text("hello")


@pytest.mark.unit
def test_embedding_health_is_ok_when_configured_model_exists() -> None:
    sdk = Mock()
    sdk.models.list.return_value.data = [Mock(id="embedding-model")]
    client = make_client(sdk)

    assert client.check_health() == "ok"
    sdk.models.list.assert_called_once_with()


@pytest.mark.unit
def test_embedding_health_is_unavailable_when_model_is_absent() -> None:
    sdk = Mock()
    sdk.models.list.return_value.data = [Mock(id="another-model")]
    client = make_client(sdk)

    assert client.check_health() == "unavailable"


@pytest.mark.unit
def test_embedding_health_is_unavailable_when_listing_fails() -> None:
    sdk = Mock()
    sdk.models.list.side_effect = ConnectionError()
    client = make_client(sdk)

    assert client.check_health() == "unavailable"


@pytest.mark.unit
def test_embed_text_not_found_becomes_model_not_found_error() -> None:
    sdk = Mock()
    sdk.embeddings.create.side_effect = NotFoundError(
        "secret model detail",
        response=httpx.Response(
            status_code=404,
            request=httpx.Request("POST", "https://model.example/embeddings"),
        ),
        body=None,
    )
    client = make_client(sdk)

    with pytest.raises(ModelNotFoundError) as exc_info:
        client.embed_text("hello")

    assert exc_info.value.safe_message == "Model not found"
    assert "secret model detail" not in exc_info.value.safe_message
