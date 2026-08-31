import pytest
from pydantic import ValidationError

from backend.app.model.prompt_model import ImageDescription


def make_description(**changes: object) -> ImageDescription:
    values: dict[str, object] = {
        "subjects": ("young woman",),
        "attributes": ("green eyes", "long dark hair"),
        "actions": ("looking at camera",),
        "setting": ("outdoors", "blurred foliage background"),
        "colors": ("green", "black"),
        "style": ("portrait photography", "soft natural light"),
        "visible_text": (),
    }
    return ImageDescription(**(values | changes))


@pytest.mark.unit
def test_formats_description_in_stable_field_order() -> None:
    description = make_description()

    assert description.to_embedding_text() == "\n".join(
        (
            "Subjects: young woman",
            "Actions: looking at camera",
            "Setting: outdoors, blurred foliage background",
            "Colors: green, black",
            "Style: portrait photography, soft natural light",
        )
    )



@pytest.mark.unit
def test_omits_empty_collection_fields() -> None:
    description = make_description(
        actions=(),
        colors=(),
        visible_text=(),
    )

    formatted = description.to_embedding_text()

    assert "Actions:" not in formatted
    assert "Colors:" not in formatted
    assert "Visible text:" not in formatted
    assert "Search keywords:" not in formatted


@pytest.mark.unit
def test_description_is_frozen() -> None:
    description = make_description()

    with pytest.raises(ValidationError):
        description.subjects = ("changed",)  # type: ignore[misc]


@pytest.mark.unit
@pytest.mark.parametrize(
    ("field", "value"),
    [("subjects", ("woman", "   "))],
)
def test_rejects_blank_description_values(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        make_description(**{field: value})
