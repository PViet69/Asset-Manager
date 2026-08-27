"""Structured image-description output used for semantic retrieval."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

NonBlankText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]


class ImageDescription(BaseModel):
    """Observable image details converted into text for embedding."""

    model_config = ConfigDict(frozen=True)

    subjects: tuple[NonBlankText, ...] = Field(
        description=(
            "Visible people, animals, products, objects, and other primary "
            "entities. Just Classify what the subject is(human or dog or cats, etc)"
        )
    )
    attributes: tuple[NonBlankText, ...] = Field(
        description=(
            "Observable appearance, clothing, materials, shapes, condition, "
            "expressions, and poses."
        )
    )
    actions: tuple[NonBlankText, ...] = Field(
        description="Visible activities, interactions, and movement."
    )
    setting: tuple[NonBlankText, ...] = Field(
        description=(
            "Environment, location type, weather, lighting, foreground, and background."
        )
    )
    colors: tuple[NonBlankText, ...] = Field(
        description="colors tied to visible content."
    )
    style: tuple[NonBlankText, ...] = Field(
        description=("style of the image, is it anime, real life or art, etc")
    )
    visible_text: tuple[NonBlankText, ...] = Field(
        description=(
            "Exactly readable visible text; omit obscured content instead of "
            "guessing. If none are present, output no text"
        )
    )
    angles: tuple[NonBlankText, ...]=Field(
        description=(
            "analyze the angles of the scene in which the picture is taken"
            "use the following angles: (frontal, below, above, behind, side)"
        )
    )

    def to_embedding_text(self) -> str:
        """Return deterministic formatted description text for embedding."""
        sections: tuple[tuple[str, tuple[str, ...]], ...] = (
            ("Subjects", self.subjects),
            ("Attributes", self.attributes),
            ("Actions", self.actions),
            ("Setting", self.setting),
            ("Colors", self.colors),
            ("Style", self.style),
            ("Visible text", self.visible_text),
            ("Angles", self.angles)
        )
        lines = tuple(
            f"{label}: {', '.join(values)}" for label, values in sections if values
        )
        return "\n".join(lines)
