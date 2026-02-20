import re


def sanitize_name(value: str) -> str:
    """Strip HTML tags and trim whitespace from a name."""
    return re.sub(r"<[^>]*>", "", value).strip()
