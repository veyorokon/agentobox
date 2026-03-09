"""Version string parsing tests.

The relay parses `claude --version` output to extract a semver string.
If it extracts garbage, the compatibility check rejects it and the relay
crash-loops — all agents stuck in "deploying" forever.

Bug: output was "2.1.71 (Claude Code)", parser did split()[-1] → "Code)".
"""

import re
import pytest


def parse_cli_version(cli_output: str) -> str:
    """Extract semver from claude --version output.

    This is the logic from relay.py _check_dependency_compatibility.
    Must handle all known output formats.
    """
    if not cli_output:
        return "unknown"
    return cli_output.strip().split()[0]


# Every known format claude --version has ever produced
KNOWN_FORMATS = [
    ("2.1.71 (Claude Code)", "2.1.71"),
    ("2.1.70 (Claude Code)", "2.1.70"),
    ("2.1.71", "2.1.71"),
    ("  2.1.71 (Claude Code)  ", "2.1.71"),  # whitespace
]


class TestParseCliVersion:

    @pytest.mark.parametrize("output,expected", KNOWN_FORMATS,
                             ids=[f[0].strip() for f in KNOWN_FORMATS])
    def test_extracts_semver(self, output, expected):
        assert parse_cli_version(output) == expected

    def test_empty_returns_unknown(self):
        assert parse_cli_version("") == "unknown"

    def test_never_returns_parenthesized_junk(self):
        """The exact bug: must never return "Code)" or "(Claude"."""
        for output, _ in KNOWN_FORMATS:
            result = parse_cli_version(output)
            assert ")" not in result, f"Parsed junk '{result}' from '{output}'"
            assert "(" not in result, f"Parsed junk '{result}' from '{output}'"

    def test_result_looks_like_semver(self):
        """Parsed version must match X.Y.Z pattern."""
        for output, _ in KNOWN_FORMATS:
            result = parse_cli_version(output)
            assert re.match(r"^\d+\.\d+\.\d+$", result), (
                f"'{result}' from '{output}' is not semver"
            )
