import pytest
from pydantic import ValidationError

from backend.app.model.prompt_model import ImageDescription


def make_description(**changes: object) -> ImageDescription:
    values: dict[str, object] = {
        "subjects": ("human",),
        "attributes": ("green eyes", "long dark hair"),
        "actions": ("looking",),
        "setting": ("outdoor",),
        "colors": ("green", "black"),
        "style": ("photo",),
        "visible_text": (),
    }
    return ImageDescription(**(values | changes))


@pytest.mark.unit
def test_formats_description_in_stable_field_order() -> None:
    description = make_description()

    assert description.to_embedding_text() == "\n".join(
        (
            "Subjects: human",
            "Actions: looking",
            "Setting: outdoor",
            "Colors: green, black",
            "Style: photo",
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
def test_rejects_values_outside_predefined_category_lists() -> None:
    with pytest.raises(ValidationError):
        ImageDescription(
            subjects=("human", "man"),
            actions=("speaking",),
            setting=("office",),
            colors=("blue",),
            style=("photo",),
            angles=("frontal",),
        )


@pytest.mark.unit
def test_json_schema_constrains_category_fields_to_catch_lists() -> None:
    schema = ImageDescription.model_json_schema()

    assert schema["$defs"]["Subject"]["enum"] == [
        "human",
        "dog",
        "cat",
        "animal",
        "product",
        "object",
        "vehicle",
        "building",
        "nature",
        "plant",
        "food",
        "furniture",
        "electronics",
        "clothing",
        "artwork",
    ]
    assert schema["properties"]["subjects"]["items"] == {"$ref": "#/$defs/Subject"}
    assert schema["properties"]["actions"]["items"] == {"$ref": "#/$defs/Action"}
    assert schema["properties"]["setting"]["items"] == {"$ref": "#/$defs/Setting"}
    assert schema["properties"]["colors"]["items"] == {"$ref": "#/$defs/Color"}
    assert schema["properties"]["style"]["items"] == {"$ref": "#/$defs/Style"}
    assert schema["properties"]["angles"]["items"] == {"$ref": "#/$defs/Angle"}


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
