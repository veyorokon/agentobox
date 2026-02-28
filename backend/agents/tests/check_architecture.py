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

failures: list[str] = []


def _read_source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _python_files(directory: Path) -> list[Path]:
    return [f for f in directory.rglob("*.py") if f.name != "__init__.py"]


def fail(msg: str) -> None:
    failures.append(msg)


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
        "reconcile", "teammate", "task", "team", "search",
    )
    for f in _python_files(SERVICES_DIR):
        tree = ast.parse(_read_source(f))
        for node in ast.walk(tree):
            if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                name = node.name
                if name.startswith("_"):
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


# ── Main ──


def main() -> int:
    checks = [
        check_adapters_no_model_imports,
        check_adapters_no_service_imports,
        check_stream_no_module_level_adapter_import,
        check_resolvers_use_adapters,
        check_resolvers_no_raw_json,
        check_service_naming,
        check_subscription_naming,
        check_no_display_fields_in_agent,
        check_no_agent_vocabulary_in_agent,
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


if __name__ == "__main__":
    sys.exit(main())
