"""Parse categorized tags from indexed asset descriptions."""

from collections.abc import Iterable

CATEGORY_PREFIXES = {
    "subjects": "subject",
    "actions": "action",
    "setting": "setting",
    "colors": "color",
    "style": "style",
    "angles": "angle",
}
CATEGORY_LABELS = {
    "subject": "Subjects",
    "action": "Actions",
    "setting": "Setting",
    "color": "Colors",
    "style": "Style",
    "angle": "Angles",
}


def parse_content_tags(content: object) -> tuple[str, ...]:
    """Return ordered canonical tags extracted from recognized content lines."""
    if not isinstance(content, str):
        return ()

    tags: list[str] = []
    seen: set[str] = set()
    for line in content.splitlines():
        label, separator, values = line.partition(":")
        if not separator:
            continue
        prefix = CATEGORY_PREFIXES.get(label.strip().casefold())
        if prefix is None:
            continue
        for raw_value in values.split(","):
            value = raw_value.strip().casefold()
            if not value:
                continue
            tag = f"{prefix}:{value}"
            if tag not in seen:
                seen.add(tag)
                tags.append(tag)
    return tuple(tags)


def group_tags(tags: Iterable[str]) -> dict[str, list[str]]:
    """Group canonical tags under their human-readable categories."""
    groups: dict[str, list[str]] = {}
    for tag in sorted(set(tags), key=str.casefold):
        prefix, separator, _ = tag.partition(":")
        label = CATEGORY_LABELS.get(prefix)
        if not separator or label is None:
            continue
        groups.setdefault(label, []).append(tag)
    return groups
