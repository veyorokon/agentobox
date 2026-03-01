"""Architectural enforcement tests.

These tests catch drift mechanically — import boundaries, naming conventions,
and model field discipline. They read source files as text and check patterns.
No Django ORM needed.
"""

import ast
import inspect
import re
from pathlib import Path

import pytest

AGENTS_DIR = Path(__file__).resolve().parent.parent
ADAPTERS_DIR = AGENTS_DIR / "adapters"
SERVICES_DIR = AGENTS_DIR / "services"
GRAPHQL_DIR = AGENTS_DIR / "graphql"


def _read_source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _python_files(directory: Path) -> list[Path]:
    return [f for f in directory.glob("*.py") if f.name != "__init__.py"]


# ── Import boundary enforcement ──


class TestImportBoundaries:
    def test_adapters_do_not_import_models(self):
        """Adapter implementations must not import agents.models."""
        for f in _python_files(ADAPTERS_DIR):
            tree = ast.parse(_read_source(f))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module:
                    assert "agents.models" not in node.module, (
                        f"{f.name} imports agents.models — adapters must not access models"
                    )

    def test_adapters_do_not_import_services(self):
        """Adapter implementations must not import agents.services."""
        for f in _python_files(ADAPTERS_DIR):
            tree = ast.parse(_read_source(f))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module:
                    assert not node.module.startswith("agents.services"), (
                        f"{f.name} imports agents.services — adapters must not access services"
                    )

    def test_stream_does_not_import_adapters_at_module_level(self):
        """Write path (stream.py) should not import adapters at module level.

        stream.py may use adapters inside _handle_result for reading last_output
        from snapshot (deferred import), but must not import at module level to
        keep the write path agent-agnostic in its module dependencies.
        """
        stream_path = SERVICES_DIR / "stream.py"
        src = _read_source(stream_path)
        # Check module-level imports only (lines before first function/class def)
        tree = ast.parse(src)
        for node in ast.iter_child_nodes(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                if isinstance(node, ast.ImportFrom) and node.module:
                    assert "agents.adapters" not in node.module, (
                        "stream.py has module-level import of agents.adapters — "
                        "keep write path agent-agnostic"
                    )

    def test_resolvers_use_adapters(self):
        """types.py must call get_adapter — enforces adapter delegation."""
        types_path = GRAPHQL_DIR / "types.py"
        src = _read_source(types_path)
        assert "get_adapter" in src, (
            "types.py does not call get_adapter — display field resolvers "
            "must delegate to adapters"
        )

    def test_resolvers_no_raw_json_access(self):
        """AgentType resolvers must not directly access Claude Code JSON paths.

        Checks only the AgentType class source, not helper functions
        like model_to_feed_item_type which serve a different purpose.
        """
        types_path = GRAPHQL_DIR / "types.py"
        src = _read_source(types_path)

        # Extract just the AgentType class source
        tree = ast.parse(src)
        agent_type_src = ""
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and node.name == "AgentType":
                agent_type_src = ast.get_source_segment(src, node) or ""
                break

        assert agent_type_src, "Could not find AgentType class in types.py"

        forbidden = [
            '.get("message"',
            '.get("content"',
            '.get("duration_ms"',
            '.get("num_turns"',
            '.get("total_cost_usd"',
        ]
        for pattern in forbidden:
            assert pattern not in agent_type_src, (
                f"AgentType contains {pattern!r} — raw JSON access belongs in adapters, "
                "not resolvers"
            )


# ── Naming convention enforcement ──


class TestNamingConventions:
    def test_service_functions_are_verb_entity(self):
        """All public async functions in services/ should follow verb_entity naming."""
        allowed_prefixes = (
            "create", "kill", "remove", "send", "set", "update", "broadcast",
            "restart", "interrupt", "clear", "recompute", "push", "process",
            "resolve", "provision", "ensure", "answer", "hard_restart",
            "write", "externalize", "upload", "encrypt", "decrypt",
            "reconcile", "teammate", "task", "team", "search",
            "get", "deliver", "list", "terminate",
        )
        violations = []

        for f in _python_files(SERVICES_DIR):
            tree = ast.parse(_read_source(f))
            for node in ast.walk(tree):
                if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                    name = node.name
                    if name.startswith("_"):
                        continue  # skip private functions
                    if not any(name.startswith(p) for p in allowed_prefixes):
                        violations.append(f"{f.name}::{name}")

        assert not violations, (
            f"Service functions not following verb_entity pattern: {violations}"
        )

    def test_graphql_mutations_are_verb_entity(self):
        """All mutation method names should follow verb_entity pattern."""
        allowed_prefixes = (
            "create", "kill", "remove", "send", "set", "update", "resolve",
            "answer", "hard_restart", "restart", "interrupt", "clear", "rate",
            "delete", "scope",
        )
        mutations_path = GRAPHQL_DIR / "mutations.py"
        tree = ast.parse(_read_source(mutations_path))

        violations = []
        for node in ast.walk(tree):
            if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                name = node.name
                if name.startswith("_"):
                    continue
                # Check if it's decorated with @strawberry.mutation
                for dec in node.decorator_list:
                    dec_name = ""
                    if isinstance(dec, ast.Attribute):
                        dec_name = dec.attr
                    elif isinstance(dec, ast.Name):
                        dec_name = dec.id
                    if dec_name == "mutation":
                        if not any(name.startswith(p) for p in allowed_prefixes):
                            violations.append(name)

        assert not violations, (
            f"Mutation names not following verb_entity pattern: {violations}"
        )

    def test_subscription_names_end_with_changed_or_stream(self):
        """Subscription method names should end with _changed or _stream."""
        subs_path = GRAPHQL_DIR / "subscriptions.py"
        tree = ast.parse(_read_source(subs_path))

        violations = []
        for node in ast.walk(tree):
            if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                name = node.name
                if name.startswith("_"):
                    continue
                for dec in node.decorator_list:
                    dec_name = ""
                    if isinstance(dec, ast.Attribute):
                        dec_name = dec.attr
                    elif isinstance(dec, ast.Name):
                        dec_name = dec.id
                    if dec_name == "subscription":
                        if not (name.endswith("_changed") or name.endswith("_stream")):
                            violations.append(name)

        assert not violations, (
            f"Subscription names should end with _changed or _stream: {violations}"
        )


# ── Model field discipline ──


class TestModelDiscipline:
    def test_agent_has_no_display_fields(self):
        """Agent model must not have display-only columns (moved to adapters)."""
        from agents.models import Agent

        display_fields = {"last_output", "live_action", "duration_ms", "num_turns"}
        model_fields = {f.name for f in Agent._meta.get_fields()}

        overlap = display_fields & model_fields
        assert not overlap, (
            f"Agent model still has display-only fields: {overlap}. "
            "These belong in adapters, not on the model."
        )

    def test_no_agent_specific_vocabulary_in_agent_model(self):
        """Agent model class must not contain Claude Code specific vocabulary as fields.

        SessionResult is allowed to have total_cost_usd — it mirrors Claude Code
        result events by design. The rule is about Agent, which should use our
        vocabulary (session_cost_usd, not total_cost_usd).
        """
        models_path = AGENTS_DIR / "models.py"
        src = _read_source(models_path)

        # Extract the Agent class source
        tree = ast.parse(src)
        agent_src = ""
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and node.name == "Agent":
                agent_src = ast.get_source_segment(src, node) or ""
                break

        assert agent_src, "Could not find Agent class in models.py"

        # These are Claude Code vocabulary that should not be Agent field names
        forbidden = ["total_cost_usd", "permissionMode", "content_block_start"]
        for term in forbidden:
            assert term not in agent_src, (
                f"Agent model contains agent-specific vocabulary: {term!r}"
            )


# ── Vocabulary enforcement ──


class TestVocabularyEnforcement:
    """Catch deprecated terminology before it takes root."""

    BANNED_TERMS = [
        "TodoProgress",
        "todo_progress",
        "todoProgress",
    ]

    # Files exempt from vocabulary checks (static reference, test fixtures)
    EXEMPT_PATHS = {"prototype", "test_", "__pycache__", ".venv", "node_modules"}

    def _should_check(self, path: Path) -> bool:
        return not any(exempt in str(path) for exempt in self.EXEMPT_PATHS)

    def test_no_todo_vocabulary_in_backend(self):
        """Backend Python files must use 'task' not 'todo' for progress tracking."""
        violations = []
        for f in AGENTS_DIR.rglob("*.py"):
            if not self._should_check(f):
                continue
            src = _read_source(f)
            for term in self.BANNED_TERMS:
                if term in src:
                    violations.append(f"{f.relative_to(AGENTS_DIR)}::{term}")

        assert not violations, (
            f"Banned vocabulary found (use TaskProgress, not TodoProgress): {violations}"
        )

    def test_no_todo_vocabulary_in_graphql_types(self):
        """GraphQL type classes must not use 'Todo' prefix."""
        types_path = GRAPHQL_DIR / "types.py"
        tree = ast.parse(_read_source(types_path))

        violations = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and "Todo" in node.name:
                violations.append(node.name)

        assert not violations, (
            f"GraphQL types using banned 'Todo' prefix: {violations}. "
            "Use 'Task' instead."
        )


# ── Adapter purity ──


class TestAdapterPurity:
    """Adapter read methods must not silently truncate or modify content."""

    def test_read_methods_do_not_slice_strings(self):
        """Adapter methods returning str must not use [:N] slices.

        Silent truncation hides data from downstream consumers. If a limit
        is needed, it belongs at the storage or display layer, not in the
        adapter's read path.
        """
        violations = []
        for f in _python_files(ADAPTERS_DIR):
            tree = ast.parse(_read_source(f))
            for node in ast.walk(tree):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                # Only check methods with return annotation of str
                if not (node.returns and isinstance(node.returns, ast.Constant)
                        and node.returns.value == "str"):
                    # Also catch ast.Name "str"
                    if not (node.returns and isinstance(node.returns, ast.Name)
                            and node.returns.id == "str"):
                        continue
                # Walk function body for Subscript with slice
                for child in ast.walk(node):
                    if isinstance(child, ast.Subscript) and isinstance(child.slice, ast.Slice):
                        if child.slice.upper is not None:
                            violations.append(f"{f.name}::{node.name}")

        assert not violations, (
            f"Adapter read methods contain string slicing ([:N]): {violations}. "
            "Adapters must return full content — truncation belongs at storage/display layer."
        )
