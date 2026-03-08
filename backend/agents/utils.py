import re


def sanitize_name(value: str) -> str:
    """Strip HTML tags and trim whitespace from a name."""
    return re.sub(r"<[^>]*>", "", value).strip()


def sanitize_skill_name(name: str) -> str:
    """Sanitize a skill name for use as a filesystem directory name.

    Prevents path traversal by replacing / and .. with underscores.
    Returns empty string for invalid names (caller should skip).
    """
    return name.replace("/", "_").replace("..", "_").strip(".")
