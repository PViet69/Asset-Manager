"""Structured image-description output used for semantic retrieval."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

NonBlankText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]

# Immutable tuple lists defining what each category can catch for prompting/retrieval.
SUBJECT_CATCH_LIST: tuple[str, ...] = (
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
)


ACTION_CATCH_LIST: tuple[str, ...] = (
    "walking",
    "running",
    "sitting",
    "standing",
    "reading",
    "speaking",
    "driving",
    "eating",
    "playing",
    "looking",
    "flying",
    "swimming",
    "working",
    "sleeping",
    "holding",
)

SETTING_CATCH_LIST: tuple[str, ...] = (
    "indoor",
    "outdoor",
    "park",
    "office",
    "street",
    "beach",
    "room",
    "forest",
    "city",
    "nature",
    "mountain",
    "studio",
    "sky",
    "underwater",
)

COLOR_CATCH_LIST: tuple[str, ...] = (
    "red",
    "blue",
    "green",
    "yellow",
    "black",
    "white",
    "brown",
    "grey",
    "orange",
    "purple",
    "pink",
    "beige",
    "gold",
    "silver",
    "metallic",
)

STYLE_CATCH_LIST: tuple[str, ...] = (
    "real life",
    "photo",
    "anime",
    "art",
    "illustration",
    "3d render",
    "painting",
    "drawing",
)

ANGLE_CATCH_LIST: tuple[str, ...] = (
    "frontal",
    "below",
    "above",
    "behind",
    "side",
)


class ImageDescription(BaseModel):
    """Observable image details converted into text for embedding."""

    model_config = ConfigDict(frozen=True)

    subjects: tuple[NonBlankText, ...] = Field(
        description=(
            "Visible people, animals, products, objects, and other primary entities. "
            f"Classify what the subject is (e.g. {', '.join(SUBJECT_CATCH_LIST)})."
        )
    )

    actions: tuple[NonBlankText, ...] = Field(
        description=(
            "Visible activities, interactions, and movement "
            f"(e.g. {', '.join(ACTION_CATCH_LIST)})."
        )
    )
    setting: tuple[NonBlankText, ...] = Field(
        description=(
            "Environment, location type, weather, lighting, foreground, and background "
            f"(e.g. {', '.join(SETTING_CATCH_LIST)})."
        )
    )
    colors: tuple[NonBlankText, ...] = Field(
        description=f"Colors tied to visible content (e.g. {', '.join(COLOR_CATCH_LIST)})."
    )
    style: tuple[NonBlankText, ...] = Field(
        description=f"Style of the image (e.g. {', '.join(STYLE_CATCH_LIST)})."
    )
    visible_text: tuple[NonBlankText, ...] = Field(
        default=(),
        description=(
            "Exactly readable vi"
            "sible text; omit obscured content instead of "
            "guessing. If none are present, output no text."
        ),
    )
    angles: tuple[NonBlankText, ...] = Field(
        default=(),
        description=(
            "Analyze the angles of the scene in which the picture is taken "
            f"(e.g. {', '.join(ANGLE_CATCH_LIST)})."
        ),
    )

    def to_embedding_text(self) -> str:
        """Return deterministic formatted description text for embedding."""
        sections: tuple[tuple[str, tuple[str, ...]], ...] = (
            ("Subjects", self.subjects),
            ("Actions", self.actions),
            ("Setting", self.setting),
            ("Colors", self.colors),
            ("Style", self.style),
            ("Visible text", self.visible_text),
            ("Angles", self.angles),
        )
        lines = tuple(
            f"{label}: {', '.join(values)}" for label, values in sections if values
        )
        return "\n".join(lines)
