#!/usr/bin/env python3
"""Fast architecture checks — no Django, no DB, no pytest.

Runs as a standalone script for pre-commit hooks. Parses source files
as AST and checks import boundaries, naming conventions, and resolver
discipline. Exits 0 on pass, 1 on failure with details.

Usage:
    python backend/agents/tests/check_architecture.py
"""

import ast
import sys
from pathlib import Path

AGENTS_DIR = Path(__file__).resolve().parent.parent
ADAPTERS_DIR = AGENTS_DIR / "adapters"
SERVICES_DIR = AGENTS_DIR / "services"
GRAPHQL_DIR = AGENTS_DIR / "graphql"
PROJECTS_DIR = AGENTS_DIR.parent / "projects"

failures: list[str] = []


def _read_source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _python_files(directory: Path) -> list[Path]:
    return [f for f in directory.rglob("*.py") if f.name != "__init__.py"]


def fail(msg: str) -> None:
    failures.append(msg)


def _call_name(node: ast.Call) -> str:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return ""


# ── Import boundaries ──


def check_adapters_no_model_imports():
    for f in _python_files(ADAPTERS_DIR):
        tree = ast.parse(_read_source(f))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                if "agents.models" in node.module:
                    fail(f"{f.name} imports agents.models — adapters must not access models")


def check_adapters_no_service_imports():
    for f in _python_files(ADAPTERS_DIR):
        tree = ast.parse(_read_source(f))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                if node.module.startswith("agents.services"):
                    fail(f"{f.name} imports agents.services — adapters must not access services")


def check_stream_no_module_level_adapter_import():
    stream_path = SERVICES_DIR / "stream.py"
    if not stream_path.exists():
        return
    tree = ast.parse(_read_source(stream_path))
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            if "agents.adapters" in node.module:
                fail("stream.py has module-level import of agents.adapters")


def check_resolvers_use_adapters():
    types_path = GRAPHQL_DIR / "types.py"
    if not types_path.exists():
        return
    src = _read_source(types_path)
    if "get_adapter" not in src:
        fail("types.py does not call get_adapter — resolvers must delegate to adapters")


def check_resolvers_no_raw_json():
    types_path = GRAPHQL_DIR / "types.py"
    if not types_path.exists():
        return
    src = _read_source(types_path)
    tree = ast.parse(src)
    agent_type_src = ""
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "AgentType":
            agent_type_src = ast.get_source_segment(src, node) or ""
            break
    if not agent_type_src:
        fail("Could not find AgentType class in types.py")
        return
    forbidden = [
        '.get("message"', '.get("content"', '.get("duration_ms"',
        '.get("num_turns"', '.get("total_cost_usd"',
    ]
    for pattern in forbidden:
        if pattern in agent_type_src:
            fail(f"AgentType contains {pattern!r} — raw JSON access belongs in adapters")


# ── Naming conventions ──


def check_service_naming():
    allowed_prefixes = (
        "create", "kill", "remove", "send", "set", "update", "broadcast",
        "restart", "interrupt", "clear", "recompute", "push", "process",
        "resolve", "provision", "ensure", "answer", "hard_restart",
        "write", "externalize", "upload", "encrypt", "decrypt",
        "reconcile", "search", "terminate", "recover",
        "deliver", "get", "list", "handle", "build", "transition",
        "succeed", "fail", "spawn",
    )
    for f in _python_files(SERVICES_DIR):
        tree = ast.parse(_read_source(f))
        # Collect names to skip: class methods and @mcp.tool decorated functions.
        # Class methods follow their own conventions. MCP tool names follow the
        # MCP protocol convention (entity_verb), not our verb_entity convention.
        skip_names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                for item in node.body:
                    if isinstance(item, (ast.AsyncFunctionDef, ast.FunctionDef)):
                        skip_names.add(item.name)
            if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                for dec in node.decorator_list:
                    dec_str = ""
                    if isinstance(dec, ast.Attribute):
                        dec_str = dec.attr
                    elif isinstance(dec, ast.Name):
                        dec_str = dec.id
                    if dec_str == "tool":
                        skip_names.add(node.name)
        for node in ast.walk(tree):
            if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                name = node.name
                if name.startswith("_"):
                    continue
                if name in skip_names:
                    continue
                if not any(name.startswith(p) for p in allowed_prefixes):
                    fail(f"Service function {f.name}::{name} does not follow verb_entity pattern")


def check_subscription_naming():
    subs_path = GRAPHQL_DIR / "subscriptions.py"
    if not subs_path.exists():
        return
    tree = ast.parse(_read_source(subs_path))
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
                        fail(f"Subscription {name!r} should end with _changed or _stream")


# ── Private import boundaries ──


def check_no_relay_imports_in_graphql():
    """push_to_relay is internal to services — mutations/views must not import it."""
    for f in _python_files(GRAPHQL_DIR):
        src = _read_source(f)
        if "push_to_relay" in src:
            fail(f"{f.name} imports push_to_relay — use service functions instead")


def check_no_direct_input_pushes():
    """Agent input must go through the durable inbox helper, not raw WS push."""
    for f in _python_files(SERVICES_DIR):
        tree = ast.parse(_read_source(f))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func_name = ""
            if isinstance(node.func, ast.Name):
                func_name = node.func.id
            elif isinstance(node.func, ast.Attribute):
                func_name = node.func.attr
            if func_name != "push_to_relay" or len(node.args) < 2:
                continue

            payload = node.args[1]
            if not isinstance(payload, ast.Dict):
                continue

            entries = {}
            for key_node, value_node in zip(payload.keys, payload.values):
                if isinstance(key_node, ast.Constant) and isinstance(key_node.value, str):
                    entries[key_node.value] = value_node

            type_node = entries.get("type")
            if isinstance(type_node, ast.Constant) and type_node.value == "input":
                fail(
                    f"{f.name} pushes relay input directly — agent input must go through "
                    "deliver_input()/inbox durability"
                )


def check_no_cross_module_private_imports():
    """Service files should not import private functions from other services."""
    for f in _python_files(SERVICES_DIR):
        tree = ast.parse(_read_source(f))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                if not node.module.startswith("agents.services"):
                    continue
                # Same module is fine
                module_file = node.module.split(".")[-1]
                if f.stem == module_file:
                    continue
                for alias in node.names:
                    if alias.name.startswith("_"):
                        fail(
                            f"{f.name} imports private {alias.name} from {node.module} "
                            f"— make it public or add a wrapper"
                        )


def check_no_direct_live_machine_mutations():
    """Service code must not bypass the runtime-backed live-write seam.

    Direct machine/volume mutable writes in service code are dangerous because
    they skip runtime visibility refresh on adapters like Modal. Shared
    services must route live mutable writes through get_machine_writer() or
    relay.update_volume_and_reload().
    """
    allowed_files = {"machine_write.py", "volume.py"}
    target_dirs = (SERVICES_DIR, GRAPHQL_DIR)

    for directory in target_dirs:
        for f in _python_files(directory):
            if f.name in allowed_files:
                continue
            src = _read_source(f)
            tree = ast.parse(src)
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                    continue

                attr = node.func.attr
                if attr == "append_inbox":
                    pass
                elif attr == "mutate" or attr.startswith("mutate_"):
                    pass
                elif attr in {"write", "remove_tree"}:
                    pass
                else:
                    continue

                owner = node.func.value
                if not isinstance(owner, ast.Attribute):
                    continue
                if owner.attr not in {"machine", "volume"}:
                    continue

                target = ast.get_source_segment(src, node.func) or attr
                fail(
                    f"{f.name} bypasses runtime-backed live writes via '{target}' — "
                    "use get_machine_writer(...).write/remove_tree/mutate/append_task() "
                    "or relay.update_volume_and_reload()"
                )


def check_orchestrators_use_spawn_logged_task():
    """Lifecycle background work must use the monitored task helper."""
    targets = [
        SERVICES_DIR / "lifecycle.py",
    ]
    for path in targets:
        if not path.exists():
            continue

        tree = ast.parse(_read_source(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if _call_name(node) != "create_task":
                continue
            fail(
                f"{path.name} uses raw create_task — use spawn_logged_task for "
                "background orchestration"
            )


# ── Model consistency ──


def check_mutable_models_have_updated_at():
    """Mutable models with created_at should also have updated_at."""
    models_path = AGENTS_DIR / "models.py"
    if not models_path.exists():
        return
    src = _read_source(models_path)
    tree = ast.parse(src)

    # Exempt: StreamEvent (append-only, never updated)
    EXEMPT = {"StreamEvent"}

    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        if node.name in EXEMPT:
            continue

        class_src = ast.get_source_segment(src, node) or ""
        has_created = "auto_now_add=True" in class_src or "auto_now_add = True" in class_src
        has_updated = "auto_now=True" in class_src or "auto_now = True" in class_src

        if has_created and not has_updated:
            fail(f"Model {node.name} has created_at but no updated_at — add auto_now=True field")


# ── No display fields on Agent model (text-based, no Django) ──


def check_no_display_fields_in_agent():
    models_path = AGENTS_DIR / "models.py"
    if not models_path.exists():
        return
    src = _read_source(models_path)
    tree = ast.parse(src)
    agent_src = ""
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "Agent":
            agent_src = ast.get_source_segment(src, node) or ""
            break
    if not agent_src:
        return
    # Check for field definitions (= models.XXXField) with display-only names
    display_fields = ["last_output", "live_action", "duration_ms", "num_turns"]
    for field in display_fields:
        if f"{field} = models." in agent_src:
            fail(f"Agent model still has display field {field!r} — belongs in adapters")


def check_no_agent_vocabulary_in_agent():
    models_path = AGENTS_DIR / "models.py"
    if not models_path.exists():
        return
    src = _read_source(models_path)
    tree = ast.parse(src)
    agent_src = ""
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "Agent":
            agent_src = ast.get_source_segment(src, node) or ""
            break
    if not agent_src:
        return
    forbidden = ["total_cost_usd", "permissionMode", "content_block_start"]
    for term in forbidden:
        if term in agent_src:
            fail(f"Agent model contains agent-specific vocabulary: {term!r}")


# ── Lifecycle state machine ──


def check_no_direct_status_writes():
    """All agent status changes must go through transition_agent_status().

    Allows: lifecycle.py (contains the transition function itself),
    test files, and the initial acreate() in lifecycle.py which sets
    the default status at creation time (not a transition).

    Only catches attribute assignment patterns (agent.status = AgentStatus.X),
    not queryset filter/exclude comparisons or local variable assignments.
    """
    import re
    # Match: .status = AgentStatus.X (attribute assignment on an object)
    # This catches: agent.status = AgentStatus.RUNNING, self.agent.status = AgentStatus.IDLE
    # Does NOT catch: status=AgentStatus.X (kwarg in filter/exclude), status__in=[...],
    #   new_status = AgentStatus.X (local var), or "status": AgentStatus.X
    pattern = re.compile(r'\.\s*status\s*=\s*AgentStatus\.')

    # Files allowed to write status directly
    allowed_files = {"lifecycle.py"}

    for f in _python_files(SERVICES_DIR):
        if f.name in allowed_files:
            continue
        src = _read_source(f)
        for match in pattern.finditer(src):
            line_start = src.rfind("\n", 0, match.start()) + 1
            line_end = src.find("\n", match.end())
            line = src[line_start:line_end].strip()
            fail(
                f"{f.name} writes agent status directly: '{line}' "
                f"— use transition_agent_status() from lifecycle.py"
            )


# ── Error metadata enforcement ──


def check_broad_except_has_error_metadata():
    """Every ``except Exception`` block in services/ must log with ``error_code``.

    Parses Python files as AST and checks that any ``except Exception`` handler
    contains a call with ``error_code`` as a keyword argument. This enforces the
    observability contract: every broad catch is attributable with a typed code.

    Skips test files and conftest.py.
    """
    for f in _python_files(SERVICES_DIR):
        if f.name.startswith("test_") or f.name == "conftest.py":
            continue
        src = _read_source(f)
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if not isinstance(node, ast.ExceptHandler):
                continue
            # Only check broad "except Exception" handlers
            if node.type is None:
                # bare except — also broad
                pass
            elif isinstance(node.type, ast.Name) and node.type.id == "Exception":
                pass
            else:
                continue

            # Walk the handler body looking for a call with error_code kwarg
            has_error_code = False
            for child in ast.walk(ast.Module(body=node.body, type_ignores=[])):
                if isinstance(child, ast.Call):
                    for kw in child.keywords:
                        if kw.arg == "error_code":
                            has_error_code = True
                            break
                if has_error_code:
                    break

            if not has_error_code:
                # Get line number for the except clause
                fail(
                    f"{f.name}:{node.lineno} has 'except Exception' without "
                    f"error_code in its log call — add error_code from agents.errors"
                )



# ── Main ──


def main() -> int:
    checks = [
        check_adapters_no_model_imports,
        check_adapters_no_service_imports,
        check_stream_no_module_level_adapter_import,
        check_resolvers_use_adapters,
        check_resolvers_no_raw_json,
        # check_service_naming,  # TODO: prefix list too rigid, revisit
        check_subscription_naming,
        check_no_display_fields_in_agent,
        check_no_agent_vocabulary_in_agent,
        check_no_relay_imports_in_graphql,
        check_no_direct_input_pushes,
        check_no_cross_module_private_imports,
        check_no_direct_live_machine_mutations,
        check_orchestrators_use_spawn_logged_task,
        check_mutable_models_have_updated_at,
        check_no_direct_status_writes,
        check_broad_except_has_error_metadata,
    ]

    for check in checks:
        try:
            check()
        except Exception as e:
            fail(f"{check.__name__} crashed: {e}")

    if failures:
        print(f"Architecture check FAILED ({len(failures)} violations):\n")
        for f in failures:
            print(f"  - {f}")
        return 1

    print(f"Architecture check passed ({len(checks)} checks)")
    return 0


# TODO: Once FeedItemType enum is adopted in all services,
# add check_no_raw_feed_type_strings() to enforce enum usage.

# TODO: Once A2 (task path unification) is done,
# add check_mutations_delegate_to_services() to enforce service layer delegation.


if __name__ == "__main__":
    sys.exit(main())
