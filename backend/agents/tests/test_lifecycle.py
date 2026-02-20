"""Tests for agents.services.lifecycle — shell escape utility."""

from agents.services.lifecycle import _shell_escape


def test_shell_escape_basic():
    """Normal strings with no special chars pass through unchanged."""
    assert _shell_escape("hello-world") == "hello-world"
    assert _shell_escape("my_agent_name") == "my_agent_name"
    assert _shell_escape("") == ""


def test_shell_escape_single_quotes():
    """Single quotes are escaped with the end-quote-backslash-quote-start-quote pattern."""
    # In shell: 'it'\''s' => it's
    assert _shell_escape("it's") == "it'\\''s"
    assert _shell_escape("'") == "'\\''", "lone single quote should be escaped"


def test_shell_escape_dollar_signs():
    """Dollar signs are safe inside single quotes — no expansion occurs.

    _shell_escape only handles single-quote escaping because the values
    are always placed inside single quotes in the shell (e.g. export VAR='...').
    Dollar signs don't expand inside single quotes, so they pass through.
    """
    assert _shell_escape("$HOME") == "$HOME"
    assert _shell_escape("cost=$100") == "cost=$100"


def test_shell_escape_backticks():
    """Backticks are safe inside single quotes — no command substitution.

    Same reasoning as dollar signs: inside single quotes, backticks are literal.
    """
    assert _shell_escape("`whoami`") == "`whoami`"
    assert _shell_escape("echo `ls`") == "echo `ls`"


def test_shell_escape_mixed_special_chars():
    """Strings with single quotes AND other special chars."""
    result = _shell_escape("it's $HOME `pwd`")
    assert result == "it'\\''s $HOME `pwd`"
