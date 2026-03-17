"""Architectural enforcement tests.

These tests catch drift mechanically — import boundaries, naming conventions,
and model field discipline. They read source files as text and check patterns.
No Django ORM needed (except schema contract test which needs Strawberry).
"""

import ast
import json
import re
from pathlib import Path

import pytest

pytestmark = [pytest.mark.unit, pytest.mark.invariant]

AGENTS_DIR = Path(__file__).resolve().parent.parent
ADAPTERS_DIR = AGENTS_DIR / "adapters"
SERVICES_DIR = AGENTS_DIR / "services"
GRAPHQL_DIR = AGENTS_DIR / "graphql"
PROJECT_ROOT = AGENTS_DIR.parent.parent  # backend/
# agent/ and dashboard/ dirs: check repo layout first, fall back to container mounts
_REPO_ROOT = PROJECT_ROOT.parent
AGENT_ROOT = _REPO_ROOT / "agent" if (_REPO_ROOT / "agent").is_dir() else Path("/agent")
DASHBOARD_ROOT = _REPO_ROOT / "dashboard" if (_REPO_ROOT / "dashboard").is_dir() else Path("/dashboard")

# Old rootfs dirs no longer exist — empty list so tests that reference them skip gracefully.
AGENT_ROOTFS_DIRS: list[Path] = []


def _read_source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _python_files(directory: Path) -> list[Path]:
    return [f for f in directory.glob("*.py") if f.name != "__init__.py"]


# ── Import boundary enforcement ──


class TestImportBoundaries:
    """Principle: layer boundaries are enforced by import direction.

    Adapters must not import models or services — they're pure functions of
    dict input. The stream write path must not import adapters at module level
    to stay agent-type-agnostic. Resolvers must use adapters, not raw JSON.
    """

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
    """Principle: public API names are self-documenting via verb_entity pattern.

    Service functions and mutations follow naming conventions that make the
    codebase navigable without reading implementations. Service functions
    start with a verb, mutations are verb_entity.
    """

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

    def test_model_methods_follow_naming_conventions(self):
        """Public model methods use get_* for queries, *_live for computed properties.

        get_* — returns data derived from related queries (e.g. get_runtime_history)
        *_live — computed property including in-progress state (e.g. compute_seconds_live)
        Standard Django overrides (save, clean, __str__, etc.) are exempt.
        """
        django_builtins = {
            "save", "delete", "clean", "full_clean", "validate_unique",
            "get_absolute_url", "get_queryset", "natural_key", "from_db",
        }
        # Properties that act as computed accessors — not verb-prefixed methods
        exempt_properties = {"volume", "needs_reconcile"}
        # QuerySet subclasses follow Django's queryset conventions (filter-style names)
        exempt_classes = {"AgentQuerySet"}
        allowed_prefixes = (
            "get_", "set_", "has_", "is_", "can_",  # accessors / predicates
        )
        allowed_suffixes = (
            "_live",  # computed properties including in-progress state
        )
        models_path = AGENTS_DIR / "models.py"
        tree = ast.parse(_read_source(models_path))

        violations = []
        for cls_node in ast.walk(tree):
            if not isinstance(cls_node, ast.ClassDef):
                continue
            if cls_node.name in exempt_classes:
                continue
            for node in cls_node.body:
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                name = node.name
                if name.startswith("_"):
                    continue
                if name in django_builtins:
                    continue
                if name in exempt_properties:
                    continue
                if any(name.startswith(p) for p in allowed_prefixes):
                    continue
                if any(name.endswith(s) for s in allowed_suffixes):
                    continue
                violations.append(f"{cls_node.name}::{name}")

        assert not violations, (
            f"Model methods not following naming conventions "
            f"(get_*, set_*, has_*, is_*, can_*, *_live): {violations}"
        )


# ── Model field discipline ──


class TestModelDiscipline:
    """Principle: Agent model holds state, not presentation.

    Display-only fields (last_output, live_action, etc.) belong in adapters,
    not on the model. Agent-type-specific vocabulary (Claude Code field names)
    must not leak into the Agent model — we use our own vocabulary.
    """

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


# ── Observation loop completeness ──


class TestObservationLoop:
    """Every state mutation must complete the observation loop.

    If the backend changes agent/task/feed state but doesn't broadcast,
    the dashboard lies. These tests scan mutation handlers for .asave()
    and .acreate() calls and verify a corresponding broadcast call exists
    in the same function body.
    """

    def _functions_in_file(self, path: Path) -> list[tuple[str, str]]:
        """Return (function_name, function_source) for all async functions."""
        src = _read_source(path)
        tree = ast.parse(src)
        results = []
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef):
                fn_src = ast.get_source_segment(src, node) or ""
                results.append((node.name, fn_src))
        return results

    def test_agent_mutations_must_broadcast(self):
        """GraphQL mutations that save Agent state must call broadcast_agent_update.

        Mutations on non-agent models (feedback, skills) are exempt — they don't
        change dashboard-visible agent state. Mutations that delegate to mcp_coord
        are also exempt since mcp_coord handles its own broadcasts.
        """
        mutations_path = GRAPHQL_DIR / "mutations.py"
        violations = []

        # Mutations that return AgentType are agent mutations
        src = _read_source(mutations_path)
        tree = ast.parse(src)

        for node in ast.walk(tree):
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            if node.name.startswith("_"):
                continue

            fn_src = ast.get_source_segment(src, node) or ""

            # Only check functions that save AND return AgentType
            has_save = ".asave(" in fn_src
            returns_agent = "AgentType" in (ast.dump(node.returns) if node.returns else "")
            if not (has_save and returns_agent):
                continue

            # Exempt: delegates to mcp_coord (which handles its own broadcasts)
            delegates_to_mcp = "mcp_coord." in fn_src
            if delegates_to_mcp:
                continue

            has_broadcast = "broadcast_agent_update" in fn_src
            if not has_broadcast:
                violations.append(node.name)

        assert not violations, (
            f"Agent mutations with .asave() but no broadcast_agent_update: {violations}. "
            "Every agent state change must complete the observation loop."
        )

    def test_mcp_coord_task_mutations_broadcast(self):
        """MCP coord task create/update must broadcast after state changes."""
        mcp_path = SERVICES_DIR / "mcp_coord.py"
        src = _read_source(mcp_path)
        tree = ast.parse(src)

        # Check the core logic functions (not the @mcp.tool wrappers)
        target_fns = {"create_task", "update_task"}
        violations = []

        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef) and node.name in target_fns:
                fn_src = ast.get_source_segment(src, node) or ""
                if "broadcast_agent_update" not in fn_src:
                    violations.append(node.name)

        assert not violations, (
            f"MCP coord functions missing broadcast_agent_update: {violations}. "
            "Task mutations must create status events and feed items."
        )

    def test_lifecycle_state_changes_broadcast(self):
        """Lifecycle functions that change agent.status must broadcast."""
        lifecycle_path = SERVICES_DIR / "lifecycle.py"
        violations = []

        for name, fn_src in self._functions_in_file(lifecycle_path):
            if name.startswith("_"):
                continue
            # Check for status assignment pattern
            changes_status = (
                '.status = ' in fn_src
                or 'update_fields=["status"' in fn_src
                or "update_fields=['status'" in fn_src
            )
            if not changes_status:
                continue
            if "broadcast_agent_update" not in fn_src:
                violations.append(name)

        assert not violations, (
            f"Lifecycle functions changing status without broadcast: {violations}. "
            "Every status change must complete the observation loop."
        )


# ── Schema contract ──


class TestSchemaContract:
    """The checked-in schema.graphql must match what the backend actually serves.

    If someone changes a Python type but forgets `make schema`, the frontend
    builds against a stale contract. This test catches that drift.
    """

    def test_schema_matches_checked_in_file(self):
        """Generated schema must match dashboard/schema.graphql."""
        schema_path = DASHBOARD_ROOT / "schema.graphql"
        if not schema_path.exists():
            pytest.skip("dashboard/schema.graphql not found")

        from schema import schema
        generated = schema.as_str()
        checked_in = schema_path.read_text(encoding="utf-8")

        assert generated.strip() == checked_in.strip(), (
            "GraphQL schema drift detected — the checked-in dashboard/schema.graphql "
            "does not match what the backend generates. Run `make schema` to sync."
        )


# ── Cross-boundary contract pinning ──


class TestCrossBoundaryContracts:
    """The hook bridge and backend must agree on tool names.

    The hook bridge (team-bridge.py) intercepts CC native tool calls by name.
    The backend (views.py) maps those names to handler functions. If either
    side drifts, tools silently stop working — no error, no log, just broken.
    """

    def _extract_bridge_set(self) -> set[str]:
        """Extract BRIDGED tool names from team-bridge.py."""
        bridge_path = None
        for rootfs in AGENT_ROOTFS_DIRS:
            candidate = rootfs / "opt" / "abox" / "hooks" / "team-bridge.py"
            if candidate.exists():
                bridge_path = candidate
                break
        if bridge_path is None:
            pytest.skip("team-bridge.py not found")
        src = _read_source(bridge_path)
        tree = ast.parse(src)

        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id in ("BRIDGED", "PRE", "POST"):
                        # PRE and POST are sets; BRIDGED = PRE | POST
                        pass
        # Simpler: just extract the string literals from PRE and POST sets
        pre = set()
        post = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id == "PRE":
                        if isinstance(node.value, ast.Set):
                            for elt in node.value.elts:
                                if isinstance(elt, ast.Constant):
                                    pre.add(elt.value)
                    if isinstance(target, ast.Name) and target.id == "POST":
                        if isinstance(node.value, ast.Set):
                            for elt in node.value.elts:
                                if isinstance(elt, ast.Constant):
                                    post.add(elt.value)
        return pre | post

    def _extract_backend_handler_names(self) -> set[str]:
        """Extract handler tool names from views.py _PRE_HANDLERS + _POST_HANDLERS."""
        views_path = GRAPHQL_DIR.parent / "views.py"
        src = _read_source(views_path)
        # Extract string keys from _PRE_HANDLERS.update({...}) and _POST_HANDLERS.update({...})
        names = set()
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                func = node.func
                if (isinstance(func, ast.Attribute)
                        and func.attr == "update"
                        and isinstance(func.value, ast.Name)
                        and func.value.id in ("_PRE_HANDLERS", "_POST_HANDLERS")):
                    for arg in node.args:
                        if isinstance(arg, ast.Dict):
                            for key in arg.keys:
                                if isinstance(key, ast.Constant):
                                    names.add(key.value)
        return names

    def test_bridge_and_backend_agree_on_tool_names(self):
        """Hook bridge BRIDGED set must match backend handler keys exactly."""
        bridge_names = self._extract_bridge_set()
        backend_names = self._extract_backend_handler_names()

        if not bridge_names:
            pytest.skip("Could not extract bridge tool names")
        if not backend_names:
            pytest.skip("Could not extract backend handler names")

        only_in_bridge = bridge_names - backend_names
        only_in_backend = backend_names - bridge_names

        assert not only_in_bridge, (
            f"Hook bridge intercepts tools the backend doesn't handle: {only_in_bridge}. "
            "Add handlers in views.py or remove from team-bridge.py."
        )
        assert not only_in_backend, (
            f"Backend handles tools the hook bridge doesn't intercept: {only_in_backend}. "
            "Add to BRIDGED set in team-bridge.py or remove from views.py."
        )


# ── Log event naming enforcement ──


# Structlog log methods whose first positional arg is the event name.
_LOG_METHODS = {"info", "warning", "error", "debug", "exception"}

# Terms too vague for a structured log event name. When you're grep-ing
# through production logs at 3am, "error" or "message" tells you nothing.
_VAGUE_EVENT_TERMS = {
    "operation", "anonymous", "error", "request", "event",
    "message", "data", "result", "process", "handle",
}

# Directories to search for log calls (structlog on backend, stdlib logging on agent).
# AGENTS_DIR.parent is the backend root (/app in Docker, backend/ on host).
_BACKEND_ROOT = AGENTS_DIR.parent
_AGENT_ABOX_DIRS = [r / "opt" / "abox" for r in AGENT_ROOTFS_DIRS if (r / "opt" / "abox").is_dir()]
_LOG_SEARCH_DIRS = [AGENTS_DIR, _BACKEND_ROOT / "config"] + _AGENT_ABOX_DIRS

# Valid event name domains — first segment of every domain.action event name.
# Adding a new domain is a deliberate architectural decision, not an accident.
_VALID_DOMAINS = {
    "adapter", "auth", "broadcast", "callback", "comms", "dashboard", "feed", "gateway",
    "graphql", "hook", "lifecycle", "mcp", "proxy", "reconciler", "relay", "runtime",
    "stream", "triggers", "vnc",
}

# Full regex: domain.action or domain.sub_action (1-2 dot-separated segments).
# Each segment starts with a lowercase letter, then lowercase alphanumeric + underscore.
_EVENT_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){1,2}$")


class TestLogEventNames:
    """Principle: log event names are grep handles, not prose.

    Every structlog event name must follow the ``domain.action`` taxonomy:
    - Format: ``^[a-z][a-z0-9]*(\\.[a-z][a-z0-9_]*){1,2}$``
    - First segment must be a registered domain in ``_VALID_DOMAINS``
    - Vague single-word names are banned

    Uses AST parsing to extract literal string event names from log calls.
    f-strings and variable references are skipped (they have dynamic parts).
    """

    _SKIP = {"tests", "migrations", "__pycache__"}

    def _should_check(self, path: Path) -> bool:
        return not any(part in self._SKIP for part in path.parts)

    def _extract_event_names(self, path: Path) -> list[tuple[str, int]]:
        """Return (event_name, lineno) for all structlog calls with literal event names."""
        src = _read_source(path)
        try:
            tree = ast.parse(src)
        except SyntaxError:
            return []

        results = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue

            # Match: <expr>.info(...), <expr>.warning(...), etc.
            func = node.func
            if not (isinstance(func, ast.Attribute) and func.attr in _LOG_METHODS):
                continue

            # Extract the first positional argument (the event name)
            if not node.args:
                # Also check for event= keyword
                event_arg = None
                for kw in node.keywords:
                    if kw.arg == "event":
                        event_arg = kw.value
                        break
                if event_arg is None:
                    continue
            else:
                event_arg = node.args[0]

            # Only check literal strings — skip f-strings, variables, expressions
            if not (isinstance(event_arg, ast.Constant) and isinstance(event_arg.value, str)):
                continue

            results.append((event_arg.value, event_arg.lineno))

        return results

    def test_event_names_follow_taxonomy(self):
        """Every structlog event name must match domain.action format with a registered domain.

        Validates:
        1. Name matches regex: lowercase domain, dot, lowercase action (1-2 segments)
        2. First segment is a registered domain from _VALID_DOMAINS
        """
        format_violations = []
        domain_violations = []

        for search_dir in _LOG_SEARCH_DIRS:
            if not search_dir.is_dir():
                continue

            for py_file in sorted(search_dir.rglob("*.py")):
                if not self._should_check(py_file):
                    continue

                for event_name, lineno in self._extract_event_names(py_file):
                    try:
                        rel = py_file.relative_to(_REPO_ROOT)
                    except ValueError:
                        rel = py_file
                    loc = f"{rel}:{lineno}"

                    if not _EVENT_NAME_PATTERN.match(event_name):
                        format_violations.append(f"{loc} → {event_name!r}")
                        continue

                    domain = event_name.split(".")[0]
                    if domain not in _VALID_DOMAINS:
                        domain_violations.append(f"{loc} → {event_name!r} (domain {domain!r})")

        errors = []
        if format_violations:
            errors.append(
                "Event names not matching domain.action format:\n"
                + "\n".join(f"  {v}" for v in format_violations)
            )
        if domain_violations:
            errors.append(
                "Event names using unregistered domains (add to _VALID_DOMAINS if intentional):\n"
                + "\n".join(f"  {v}" for v in domain_violations)
            )
        assert not errors, "\n\n".join(errors)

    def test_event_names_not_vague(self):
        """Event names must not be single vague terms from the denylist."""
        violations = []

        for search_dir in _LOG_SEARCH_DIRS:
            if not search_dir.is_dir():
                continue

            for py_file in sorted(search_dir.rglob("*.py")):
                if not self._should_check(py_file):
                    continue

                for event_name, lineno in self._extract_event_names(py_file):
                    # Check if the entire event name (case-insensitive) is a vague term
                    if event_name.lower() in _VAGUE_EVENT_TERMS:
                        try:
                            rel = py_file.relative_to(_REPO_ROOT)
                        except ValueError:
                            rel = py_file
                        violations.append(f"{rel}:{lineno} → {event_name!r}")

        assert not violations, (
            "Structlog event names are too vague (denylist match):\n"
            + "\n".join(f"  {v}" for v in violations)
            + "\n\nUse specific domain.action names — e.g. 'relay.connection_error' not 'error'."
        )


# ── Annotation enforcement ──

# Extension point — registry of annotation types. Adding a new annotation
# (e.g. "boundary:", "couples:") is one dict entry + one test method.
ANNOTATION_TYPES = {
    "intentional": {
        "pattern": r"#\s*intentional:",
        "applies_to": "except_handler",
        "description": "Broad exception catch with documented rationale",
    },
    "tech-debt": {
        "pattern": r"#\s*tech-debt:",
        "applies_to": "any",
        "description": "Known technical debt with documented rationale",
    },
}


def _source_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines()


class TestExplicitErrorHandling:
    """Principle: Fail loud, never fail silent.

    Every broad except (Exception/BaseException/bare) must be annotated with
    ``# intentional:`` explaining why the broad catch is necessary. Unannotated
    blocks are likely silent-failure bugs. This test catches them mechanically.
    """

    # Directories to skip (tests write intentionally bad code, migrations are generated)
    _SKIP = {"tests", "migrations", "__pycache__"}

    def _should_check(self, path: Path) -> bool:
        return not any(part in self._SKIP for part in path.parts)

    def _is_broad_except(self, handler: ast.ExceptHandler) -> bool:
        """True if handler catches Exception, BaseException, or is a bare except."""
        if handler.type is None:
            return True  # bare except:
        if isinstance(handler.type, ast.Name) and handler.type.id in ("Exception", "BaseException"):
            return True
        return False

    def test_broad_except_blocks_are_annotated(self):
        """Every except Exception/BaseException/bare must have # intentional: nearby."""
        pattern = re.compile(ANNOTATION_TYPES["intentional"]["pattern"])
        violations = []

        for py_file in sorted(AGENTS_DIR.rglob("*.py")):
            if not self._should_check(py_file):
                continue

            src = _read_source(py_file)
            lines = src.splitlines()
            try:
                tree = ast.parse(src)
            except SyntaxError:
                continue

            for node in ast.walk(tree):
                if not isinstance(node, ast.ExceptHandler):
                    continue
                if not self._is_broad_except(node):
                    continue

                lineno = node.lineno  # 1-indexed
                # Check the except line itself and the line above
                except_line = lines[lineno - 1] if lineno <= len(lines) else ""
                prev_line = lines[lineno - 2] if lineno >= 2 else ""

                if not (pattern.search(except_line) or pattern.search(prev_line)):
                    rel = py_file.relative_to(AGENTS_DIR)
                    violations.append(f"{rel}:{lineno}")

        assert not violations, (
            "Broad except blocks without # intentional: annotation:\n"
            + "\n".join(f"  {v}" for v in violations)
            + "\n\nAdd '# intentional: <reason>' on the except line or the line above."
        )


class TestTechDebtAnnotations:
    """Principle: Track technical debt explicitly, not in comments or memory.

    Every ``# tech-debt:`` annotation must include a non-empty explanation
    describing what the debt is and when/how it can be removed. Bare tags
    without explanations are worse than no tag — they signal debt exists but
    give no context for resolving it.

    This test walks ALL Python files in both backend/agents/ and agent/rootfs/
    to ensure tech-debt annotations are well-formed wherever they appear.
    """

    _SKIP = {"tests", "migrations", "__pycache__"}
    _SEARCH_DIRS = [AGENTS_DIR] + AGENT_ROOTFS_DIRS

    def _should_check(self, path: Path) -> bool:
        return not any(part in self._SKIP for part in path.parts)

    def test_tech_debt_annotations_have_explanations(self):
        """Every # tech-debt: tag must have a non-empty explanation after it."""
        tag_pattern = re.compile(ANNOTATION_TYPES["tech-debt"]["pattern"])
        full_pattern = re.compile(r"#\s*tech-debt:\s*(.+)")
        violations = []

        for search_dir in self._SEARCH_DIRS:
            if not search_dir.is_dir():
                continue

            for py_file in sorted(search_dir.rglob("*.py")):
                if not self._should_check(py_file):
                    continue

                src = py_file.read_text(encoding="utf-8")
                lines = src.splitlines()

                # Find lines inside string literals so we skip them
                string_lines: set[int] = set()
                try:
                    tree = ast.parse(src)
                    for node in ast.walk(tree):
                        if isinstance(node, ast.Constant) and isinstance(node.value, str):
                            if hasattr(node, "lineno") and hasattr(node, "end_lineno"):
                                for ln in range(node.lineno, (node.end_lineno or node.lineno) + 1):
                                    string_lines.add(ln)
                except SyntaxError:
                    continue

                for i, line in enumerate(lines, 1):
                    if i in string_lines:
                        continue
                    if tag_pattern.search(line) and not full_pattern.search(line):
                        try:
                            rel = py_file.relative_to(_REPO_ROOT)
                        except ValueError:
                            rel = py_file
                        violations.append(f"{rel}:{i}")

        assert not violations, (
            "tech-debt annotations without explanation:\n"
            + "\n".join(f"  {v}" for v in violations)
            + "\n\nAdd a description after '# tech-debt:' — e.g. "
            "'# tech-debt: SDK monkey-patch — remove when SDK adds .to_dict()'"
        )


# ── Async safety enforcement ──


class TestSyncToAsyncExplicit:
    """Every sync_to_async() call must specify thread_sensitive explicitly.

    The default thread_sensitive=True routes work to a single shared thread,
    which silently serializes all callers. Non-Django-ORM blocking I/O (S3
    uploads, HTTP fetches, cache calls) MUST use thread_sensitive=False.

    By requiring the kwarg everywhere, authors are forced to think about
    which thread pool the work runs on, preventing accidental serialization.
    """

    # Match sync_to_async calls WITHOUT thread_sensitive kwarg.
    # Catches: sync_to_async(fn), sync_to_async(fn)(args)
    # Allows: sync_to_async(fn, thread_sensitive=False), _s2a(fn, thread_sensitive=False)
    _CALL_RE = re.compile(r"sync_to_async\s*\([^)]*\)")

    def _find_violations(self):
        violations = []
        dirs = [SERVICES_DIR, GRAPHQL_DIR, AGENTS_DIR]
        for d in dirs:
            for py_file in d.glob("**/*.py"):
                src = _read_source(py_file)
                lines = src.splitlines()
                for i, line in enumerate(lines, 1):
                    stripped = line.lstrip()
                    if stripped.startswith("#"):
                        continue
                    if not re.search(r"(?:sync_to_async|_s2a)\s*\(", line):
                        continue
                    # Collect the full call expression (may span multiple lines)
                    # by tracking paren depth from this line forward.
                    depth = 0
                    call_text = ""
                    for j in range(i - 1, min(i + 9, len(lines))):
                        call_text += lines[j]
                        depth += lines[j].count("(") - lines[j].count(")")
                        if depth <= 0:
                            break
                    if "thread_sensitive" not in call_text:
                        try:
                            rel = py_file.relative_to(_REPO_ROOT)
                        except ValueError:
                            rel = py_file
                        violations.append(f"{rel}:{i}: {stripped.strip()}")
        return violations

    def test_sync_to_async_has_explicit_thread_sensitive(self):
        violations = self._find_violations()
        assert not violations, (
            "sync_to_async() calls without explicit thread_sensitive= kwarg:\n"
            + "\n".join(f"  {v}" for v in violations)
            + "\n\nAlways specify thread_sensitive=True or thread_sensitive=False "
            "to prevent accidental single-thread serialization."
        )


# ── WS serializer / GraphQL drift detection ──


class TestWsSerializerMatchesGraphQL:
    """The canonical serializer must mirror the GraphQL AgentType exactly.

    When a field is added to AgentType but not serialize_agent(),
    Apollo throws cache miss errors because the WS push is missing keys
    that the cache schema expects. This test catches that drift at CI time
    instead of waiting for a runtime console error.

    Extracts camelCase field keys from both sources via AST and string
    analysis, then asserts they match.
    """

    # Fields that appear in serializer but not as standalone GraphQL fields
    # (internal WS protocol fields, not part of the schema).
    _WS_ONLY = {"__typename"}

    def _extract_ws_keys(self) -> set[str]:
        """Extract string keys from serialize_agent return dict via AST."""
        serializers_path = AGENTS_DIR / "serializers.py"
        src = _read_source(serializers_path)
        tree = ast.parse(src)

        keys = set()
        for node in ast.walk(tree):
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            if node.name != "serialize_agent":
                continue
            # Find the top-level return statement with a Dict value
            for child in ast.walk(node):
                if isinstance(child, ast.Return) and isinstance(child.value, ast.Dict):
                    for key in child.value.keys:
                        if isinstance(key, ast.Constant) and isinstance(key.value, str):
                            keys.add(key.value)
                    break
            break

        return keys

    def _extract_graphql_fields(self) -> set[str]:
        """Extract camelCase field names from AgentType in types.py."""
        types_path = GRAPHQL_DIR / "types.py"
        src = _read_source(types_path)
        tree = ast.parse(src)

        fields = set()
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef) or node.name != "AgentType":
                continue

            for item in node.body:
                # Plain annotations: `name: auto`
                if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                    # Convert snake_case to camelCase
                    fields.add(self._to_camel(item.target.id))

                # @strawberry.field or @strawberry_django.field decorated methods
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    for dec in item.decorator_list:
                        dec_name = ""
                        if isinstance(dec, ast.Attribute):
                            dec_name = dec.attr
                        elif isinstance(dec, ast.Name):
                            dec_name = dec.id
                        if dec_name == "field":
                            fields.add(self._to_camel(item.name))
                            break

        return fields

    @staticmethod
    def _to_camel(snake: str) -> str:
        parts = snake.split("_")
        return parts[0] + "".join(p.capitalize() for p in parts[1:])

    def test_ws_serializer_keys_match_graphql_agent_type(self):
        """WS serializer dict keys must exactly match GraphQL AgentType fields.

        This is the canary for the feed/card desync gap — if a field is added
        to the GraphQL type but not the WS serializer (or vice versa), Apollo
        cache throws errors because the shapes don't match.
        """
        ws_keys = self._extract_ws_keys() - self._WS_ONLY
        gql_fields = self._extract_graphql_fields()

        only_in_ws = ws_keys - gql_fields
        only_in_gql = gql_fields - ws_keys

        assert not only_in_ws, (
            f"Serializer has keys not in GraphQL AgentType: {only_in_ws}. "
            "Remove from serialize_agent() or add to AgentType."
        )
        assert not only_in_gql, (
            f"GraphQL AgentType has fields not in serializer: {only_in_gql}. "
            "Add to serialize_agent() in serializers.py."
        )


# ── Dependency compatibility matrix enforcement ──


class TestDependencyCompatibilityMatrix:
    """Verify Dockerfile version pins match COMPATIBILITY.json.

    The compatibility matrix is the source of truth for known-good
    CLI + SDK + proxy version combinations. If someone bumps a version
    in the Dockerfile without updating the matrix (or vice versa),
    the relay startup check will reject the combination at runtime.
    """

    COMPAT_FILE = AGENT_ROOT / "claude" / "COMPATIBILITY.json"
    DOCKERFILE = AGENT_ROOT / "claude" / "Dockerfile"

    @pytest.fixture
    def compat_data(self):
        if not self.COMPAT_FILE.exists():
            pytest.skip(f"COMPATIBILITY.json not found at {self.COMPAT_FILE} (not in agent image context)")
        return json.loads(self.COMPAT_FILE.read_text())

    @pytest.fixture
    def dockerfile_versions(self) -> dict:
        """Parse CLI and SDK version pins from the Dockerfile."""
        if not self.DOCKERFILE.exists():
            pytest.skip(f"Dockerfile not found at {self.DOCKERFILE} (not in agent image context)")
        content = self.DOCKERFILE.read_text()

        # SDK: pip3 install ... claude-agent-sdk==X.Y.Z
        sdk_match = re.search(r"claude-agent-sdk==(\S+)", content)
        assert sdk_match, "Could not find claude-agent-sdk version pin in Dockerfile"

        # CLI: ARG CLAUDE_CODE_VERSION=X.Y.Z
        cli_match = re.search(r"ARG\s+CLAUDE_CODE_VERSION=(\S+)", content)
        assert cli_match, "Could not find CLAUDE_CODE_VERSION ARG in Dockerfile"

        return {
            "sdk": sdk_match.group(1),
            "cli": cli_match.group(1),
        }

    def test_inv_comp_001_dockerfile_pins_match_matrix(self, compat_data, dockerfile_versions):
        """Dockerfile version pins must match the 'current' entry in COMPATIBILITY.json.

        If this fails, either:
        1. You bumped a version in the Dockerfile — update COMPATIBILITY.json to match
        2. You updated COMPATIBILITY.json — update the Dockerfile pins to match
        """
        current = compat_data["current"]
        assert current["cli"] == dockerfile_versions["cli"], (
            f"CLI version mismatch: Dockerfile pins {dockerfile_versions['cli']} "
            f"but COMPATIBILITY.json current says {current['cli']}"
        )
        assert current["sdk"] == dockerfile_versions["sdk"], (
            f"SDK version mismatch: Dockerfile pins {dockerfile_versions['sdk']} "
            f"but COMPATIBILITY.json current says {current['sdk']}"
        )

    def test_inv_comp_002_compatibility_matrix_has_current_entry(self, compat_data):
        """The matrix must contain a 'verified' entry matching the current pins.

        This ensures that the current pin combination has actually been tested,
        not just declared.
        """
        current = compat_data["current"]
        verified = [
            entry for entry in compat_data["matrix"]
            if entry.get("status") == "verified"
            and entry["cli"] == current["cli"]
            and entry["sdk"] == current["sdk"]
            and entry["proxy"] == current["proxy"]
        ]
        assert verified, (
            f"No verified matrix entry for current pins: "
            f"cli={current['cli']} sdk={current['sdk']} proxy={current['proxy']}. "
            "Add a verified entry to the matrix after testing this combination."
        )


# ── Config ownership enforcement ──


CONFIG_DIR = AGENTS_DIR.parent / "config"  # backend/config/

# Policy vars that belong exclusively in app_config.py
_POLICY_VARS = {
    "AGENT_IMAGE", "ABOX_CALLBACK_URL", "ABOX_DASHBOARD_URL",
    "ANTHROPIC_API_KEY", "ABOX_ENCRYPTION_KEY", "DOCKER_NETWORK",
    "AGENT_VOLUME_NAME", "AGENT_ROOTFS_PATH", "MODAL_APP_NAME",
    "MODAL_AGENT_IMAGE", "VOLUME_ROOT", "AGENT_RUNTIME",
    "MEDIA_BUCKET", "MEDIA_CDN_URL",
}


class TestConfigOwnership:
    """Principle: settings.py owns Django, app_config owns product/runtime policy."""

    def test_no_os_getenv_outside_app_config(self):
        """Only app_config.py and telemetry.py may read os.getenv/os.environ for policy vars.

        telemetry.py gets an exception for LOG_FORMAT (presentation concern).
        """
        allowed_files = {"app_config.py", "asgi.py", "settings_test.py"}
        for py_file in CONFIG_DIR.glob("*.py"):
            if py_file.name in allowed_files:
                continue
            src = _read_source(py_file)
            # Allow os.getenv for non-policy concerns (e.g. LOG_FORMAT in telemetry.py)
            for match in re.finditer(r'os\.(?:getenv|environ\.get)\(["\'](\w+)', src):
                var_name = match.group(1)
                assert var_name not in _POLICY_VARS, (
                    f"{py_file.name} reads policy var {var_name} via os.getenv/os.environ.get. "
                    "Use config.app_config instead."
                )

    def test_no_policy_vars_in_settings(self):
        """settings.py should not define policy vars as module-level assignments."""
        src = _read_source(CONFIG_DIR / "settings.py")
        for var in _POLICY_VARS:
            # Match "VAR_NAME = env(...)" or "VAR_NAME = ..." at module level
            pattern = rf'^{var}\s*='
            assert not re.search(pattern, src, re.MULTILINE), (
                f"settings.py defines {var}. Policy vars belong in config.app_config."
            )

    def test_no_policy_os_reads_in_services(self):
        """Service files must not read policy env vars directly."""
        for py_file in SERVICES_DIR.glob("*.py"):
            src = _read_source(py_file)
            for match in re.finditer(r'os\.(?:getenv|environ\.get)\(["\'](\w+)', src):
                var_name = match.group(1)
                assert var_name not in _POLICY_VARS, (
                    f"{py_file.name} reads policy var {var_name} via os.getenv/os.environ.get. "
                    "Use config.app_config instead."
                )


class TestRuntimeOwnership:
    """Principle: runtime_name must be explicit, never silently defaulted."""

    def test_create_agent_requires_explicit_runtime(self):
        """create_agent() must not have a default runtime_name."""
        import inspect
        from agents.services.lifecycle import create_agent
        sig = inspect.signature(create_agent)
        param = sig.parameters["runtime_name"]
        assert param.default is inspect.Parameter.empty, (
            "create_agent() runtime_name has a default. "
            "It must be explicit — callers choose from app_config.agent.runtime."
        )

    def test_all_creation_paths_use_app_config_runtime(self):
        """GraphQL mutation and spawn_team_lead must use app_config.agent.runtime."""
        mutations_src = _read_source(GRAPHQL_DIR / "mutations.py")
        lifecycle_src = _read_source(SERVICES_DIR / "lifecycle.py")
        assert "app_config.agent.runtime" in mutations_src, (
            "mutations.py should use app_config.agent.runtime, not settings.AGENT_RUNTIME"
        )
        assert "app_config.agent.runtime" in lifecycle_src, (
            "lifecycle.py spawn_team_lead should use app_config.agent.runtime"
        )


class TestSerializationOwnership:
    """Principle: serialization lives in serializers.py, not consumers.py."""

    def test_no_serialize_functions_in_consumers(self):
        """consumers.py must not define _serialize_* functions."""
        src = _read_source(AGENTS_DIR / "consumers.py")
        matches = re.findall(r'^(?:async )?def _serialize_\w+', src, re.MULTILINE)
        assert not matches, (
            f"consumers.py still has serialize functions: {matches}. "
            "Move to agents.serializers."
        )

    def test_broadcast_imports_from_serializers(self):
        """broadcast.py and feed.py must import from agents.serializers, not consumers."""
        for filename in ("broadcast.py", "feed.py", "relay.py"):
            src = _read_source(SERVICES_DIR / filename)
            assert "from agents.consumers import _serialize" not in src, (
                f"{filename} imports serializers from consumers.py. "
                "Import from agents.serializers instead."
            )


class TestNoStaleSettingsRefs:
    """Principle: after config migration, no service/runtime/graphql file should
    reference django.conf.settings for policy vars.

    models.py and migrations are exempt — they use settings.AUTH_USER_MODEL
    which is a Django framework concern.
    """

    _EXEMPT = {"models.py", "__init__.py"}

    def _scan_dirs(self):
        return [SERVICES_DIR, AGENTS_DIR / "runtimes", GRAPHQL_DIR]

    def test_no_django_settings_import_in_services(self):
        """Service, runtime, and graphql files must not import django.conf.settings."""
        for scan_dir in self._scan_dirs():
            if not scan_dir.is_dir():
                continue
            for py_file in scan_dir.glob("*.py"):
                if py_file.name in self._EXEMPT:
                    continue
                src = _read_source(py_file)
                assert "from django.conf import settings" not in src, (
                    f"{py_file.relative_to(AGENTS_DIR)} imports django.conf.settings. "
                    "Use config.app_config instead."
                )

    def test_no_bare_settings_dot_refs(self):
        """No getattr(settings, ...) or settings.SOME_VAR in migrated files."""
        pattern = re.compile(r'(?:getattr\(\s*settings\b|(?<!\w)settings\.[A-Z])')
        for scan_dir in self._scan_dirs():
            if not scan_dir.is_dir():
                continue
            for py_file in scan_dir.glob("*.py"):
                if py_file.name in self._EXEMPT:
                    continue
                src = _read_source(py_file)
                matches = pattern.findall(src)
                assert not matches, (
                    f"{py_file.relative_to(AGENTS_DIR)} has stale settings refs: {matches}. "
                    "Use config.app_config instead."
                )


class TestS6ServicePreflight:
    """Principle: every s6 service must validate config before starting.

    All longrun service run scripts must source the preflight helper and
    call preflight with --service. This ensures structured JSON logging
    on missing config and immediate clean exit (no crash-loop noise).
    """

    def _longrun_run_scripts(self) -> list[tuple[str, str]]:
        """Return (service_name, run_script_content) for all longrun services."""
        results = []
        for rootfs_dir in AGENT_ROOTFS_DIRS:
            s6_rc = rootfs_dir / "etc" / "s6-overlay" / "s6-rc.d"
            if not s6_rc.is_dir():
                continue
            for svc_dir in sorted(s6_rc.iterdir()):
                if not svc_dir.name.startswith("svc-"):
                    continue
                type_file = svc_dir / "type"
                run_file = svc_dir / "run"
                if type_file.exists() and type_file.read_text().strip() == "longrun" and run_file.exists():
                    results.append((svc_dir.name, run_file.read_text()))
        return results

    def test_all_services_source_preflight(self):
        """Every longrun service must source the preflight helper."""
        for name, content in self._longrun_run_scripts():
            assert "source /etc/s6-overlay/scripts/preflight" in content, (
                f"{name}/run does not source preflight helper"
            )

    def test_all_services_call_preflight(self):
        """Every longrun service must call preflight with --service."""
        for name, content in self._longrun_run_scripts():
            assert f"preflight --service {name}" in content, (
                f"{name}/run does not call preflight --service {name}"
            )

    def test_all_services_use_abox_exec(self):
        """Every longrun service must wrap its process with abox-exec.

        abox-exec ensures ALL output (stdout + stderr) is structured JSON,
        regardless of what language or binary the service runs. This is the
        universal log normalization layer — no exceptions.
        """
        for name, content in self._longrun_run_scripts():
            assert f"abox-exec --service {name} --" in content, (
                f"{name}/run does not wrap its process with abox-exec"
            )


class TestRuntimeValidation:
    """Principle: fail loud on startup, not on first request."""

    def test_invalid_runtime_rejected_at_config_load(self):
        """AppConfig rejects invalid AGENT_RUNTIME values at instantiation."""
        import os
        from pydantic import ValidationError
        from config.app_config import AgentConfig

        env_backup = os.environ.get("AGENT_RUNTIME")
        try:
            os.environ["AGENT_RUNTIME"] = "modla"  # typo
            with pytest.raises(ValidationError):
                AgentConfig()
        finally:
            if env_backup is not None:
                os.environ["AGENT_RUNTIME"] = env_backup
            else:
                os.environ.pop("AGENT_RUNTIME", None)
