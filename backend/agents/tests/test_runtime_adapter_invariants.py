import ast
from pathlib import Path

import pytest


pytestmark = [pytest.mark.unit, pytest.mark.invariant]


REPO_ROOT = Path(__file__).resolve().parents[3]
SHARED_PATHS = [
    "backend/agents/models.py",
    "backend/agents/services/lifecycle.py",
    "backend/agents/services/machine_write.py",
    "backend/agents/services/runtime_segments.py",
]


def _read(path: str) -> str:
    return (REPO_ROOT / path).read_text()


def _parse(path: str) -> ast.AST:
    return ast.parse(_read(path), filename=path)


def _is_modal_string(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and node.value == "modal"


def test_shared_layers_do_not_import_modal_specific_implementations():
    forbidden_modules = {
        "agents.runtimes.modal",
        "agents.services.project_volume",
    }
    forbidden_names = {"ModalRuntime", "ModalProjectVolumeStore"}

    for path in SHARED_PATHS:
        tree = _parse(path)
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module in forbidden_modules:
                raise AssertionError(f"{path} still imports Modal-specific module {node.module!r}")
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name in forbidden_modules:
                        raise AssertionError(f"{path} still imports Modal-specific module {alias.name!r}")
            if isinstance(node, ast.Name) and node.id in forbidden_names:
                raise AssertionError(f"{path} still references Modal-specific symbol {node.id!r}")


def test_shared_layers_do_not_branch_on_modal_identity():
    for path in SHARED_PATHS:
        tree = _parse(path)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "get_runtime":
                if any(_is_modal_string(arg) for arg in node.args):
                    raise AssertionError(f"{path} still resolves runtime by explicit Modal identity")
            if isinstance(node, ast.Compare):
                operands = [node.left, *node.comparators]
                if any(_is_modal_string(operand) for operand in operands):
                    raise AssertionError(f"{path} still branches on explicit Modal identity")
