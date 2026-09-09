import pytest

from backend.app.tag_settings.parser import group_tags, parse_content_tags


@pytest.mark.unit
def test_parse_content_tags_returns_canonical_category_values() -> None:
    content = """Subjects: laptop, keyboard, desk
Actions: displaying, connected
Setting: indoor, office
Colors: black, blue
Style: photo, real life
Visible text: account, Action
Angles: above, side"""

    assert parse_content_tags(content) == (
        "subject:laptop",
        "subject:keyboard",
        "subject:desk",
        "action:displaying",
        "action:connected",
        "setting:indoor",
        "setting:office",
        "color:black",
        "color:blue",
        "style:photo",
        "style:real life",
        "angle:above",
        "angle:side",
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    "content", [None, 42, "Unknown: value\nSubjects: , Laptop, laptop"]
)
def test_parse_content_tags_ignores_invalid_content_and_deduplicates(
    content: object,
) -> None:
    expected = ("subject:laptop",) if isinstance(content, str) else ()

    assert parse_content_tags(content) == expected


@pytest.mark.unit
def test_group_tags_ignores_visible_text_tags() -> None:
    assert group_tags(["action:account", "visible_text:account", "color:black"]) == {
        "Actions": ["action:account"],
        "Colors": ["color:black"],
    }
