from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from backend.app.exceptions import ModelEndpointError
from backend.app.model.prompt_model import ImageDescription
from backend.app.model.video_description_client import VideoModelDescriptionClient


def make_description() -> ImageDescription:
    return ImageDescription(
        subjects=("human",),
        attributes=("presenting electronics",),
        actions=("speaking",),
        setting=("office",),
        colors=("blue",),
        style=("real life",),
        visible_text=(),
    )


@pytest.mark.unit
def test_describe_returns_description_and_deletes_uploaded_file() -> None:
    sdk = Mock()
    uploaded = SimpleNamespace(name="files/video-1", state="ACTIVE")
    sdk.files.upload.return_value = uploaded
    sdk.files.get.return_value = uploaded
    sdk.models.generate_content.return_value = SimpleNamespace(
        parsed=make_description()
    )
    client = VideoModelDescriptionClient.from_client(sdk, model_name="video-model")

    result = client.describe(b"video-bytes", "video/mp4")

    assert result == make_description()
    sdk.files.delete.assert_called_once_with(name="files/video-1")


@pytest.mark.unit
def test_describe_deletes_uploaded_file_when_generation_fails() -> None:
    sdk = Mock()
    uploaded = SimpleNamespace(name="files/video-1", state="ACTIVE")
    sdk.files.upload.return_value = uploaded
    sdk.files.get.return_value = uploaded
    sdk.models.generate_content.side_effect = RuntimeError("provider response")
    client = VideoModelDescriptionClient.from_client(sdk, model_name="video-model")

    with pytest.raises(ModelEndpointError, match="Video model request failed"):
        client.describe(b"video-bytes", "video/mp4")

    sdk.files.delete.assert_called_once_with(name="files/video-1")


@pytest.mark.unit
def test_describe_rejects_unsupported_video_mime_type() -> None:
    client = VideoModelDescriptionClient.from_client(Mock(), model_name="video-model")

    with pytest.raises(ModelEndpointError, match="Unsupported video format"):
        client.describe(b"video-bytes", "video/x-msvideo")
