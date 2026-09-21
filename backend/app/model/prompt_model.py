"""Structured image-description output used for semantic retrieval."""

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

NonBlankText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]


class Subject(StrEnum):
    HUMAN = "human"
    DOG = "dog"
    CAT = "cat"
    ANIMAL = "animal"
    PRODUCT = "product"
    OBJECT = "object"
    VEHICLE = "vehicle"
    BUILDING = "building"
    NATURE = "nature"
    PLANT = "plant"
    FOOD = "food"
    FURNITURE = "furniture"
    ELECTRONICS = "electronics"
    CLOTHING = "clothing"
    ARTWORK = "artwork"


class Action(StrEnum):
    WALKING = "walking"
    RUNNING = "running"
    SITTING = "sitting"
    STANDING = "standing"
    READING = "reading"
    SPEAKING = "speaking"
    DRIVING = "driving"
    EATING = "eating"
    PLAYING = "playing"
    LOOKING = "looking"
    FLYING = "flying"
    SWIMMING = "swimming"
    WORKING = "working"
    SLEEPING = "sleeping"
    HOLDING = "holding"


class Setting(StrEnum):
    INDOOR = "indoor"
    OUTDOOR = "outdoor"
    PARK = "park"
    OFFICE = "office"
    STREET = "street"
    BEACH = "beach"
    ROOM = "room"
    FOREST = "forest"
    CITY = "city"
    NATURE = "nature"
    MOUNTAIN = "mountain"
    STUDIO = "studio"
    SKY = "sky"
    UNDERWATER = "underwater"


class Color(StrEnum):
    RED = "red"
    BLUE = "blue"
    GREEN = "green"
    YELLOW = "yellow"
    BLACK = "black"
    WHITE = "white"
    BROWN = "brown"
    GREY = "grey"
    ORANGE = "orange"
    PURPLE = "purple"
    PINK = "pink"
    BEIGE = "beige"
    GOLD = "gold"
    SILVER = "silver"
    METALLIC = "metallic"


class Style(StrEnum):
    REAL_LIFE = "real life"
    PHOTO = "photo"
    ANIME = "anime"
    ART = "art"
    ILLUSTRATION = "illustration"
    THREE_D_RENDER = "3d render"
    PAINTING = "painting"
    DRAWING = "drawing"


class Angle(StrEnum):
    FRONTAL = "frontal"
    BELOW = "below"
    ABOVE = "above"
    BEHIND = "behind"
    SIDE = "side"


class ImageDescription(BaseModel):
    """Observable image details converted into text for embedding."""

    model_config = ConfigDict(frozen=True)

    subjects: tuple[Subject, ...] = Field(
        description=(
            "Visible people, animals, products, objects, and other primary entities. "
            f"Classify what the subject is (e.g. {', '.join(Subject)})."
        )
    )

    actions: tuple[Action, ...] = Field(
        description=(
            "Visible activities, interactions, and movement "
            f"(e.g. {', '.join(Action)})."
        )
    )
    setting: tuple[Setting, ...] = Field(
        description=(
            "Environment, location type, weather, lighting, foreground, and background "
            f"(e.g. {', '.join(Setting)})."
        )
    )
    colors: tuple[Color, ...] = Field(
        description=(f"Colors tied to visible content (e.g. {', '.join(Color)}).")
    )
    style: tuple[Style, ...] = Field(
        description=f"Style of the image (e.g. {', '.join(Style)})."
    )
    visible_text: tuple[NonBlankText, ...] = Field(
        default=(),
        description=(
            "Exactly readable vi"
            "sible text; omit obscured content instead of "
            "guessing. If none are present, output no text."
        ),
    )
    angles: tuple[Angle, ...] = Field(
        default=(),
        description=(
            "Analyze the angles of the scene in which the picture is taken "
            f"(e.g. {', '.join(Angle)})."
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
