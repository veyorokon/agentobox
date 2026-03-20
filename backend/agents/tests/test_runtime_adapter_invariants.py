from pathlib import Path

import pytest


pytestmark = [pytest.mark.unit, pytest.mark.invariant]


REPO_ROOT = Path(__file__).resolve().parents[3]


def _read(path: str) -> str:
    return (REPO_ROOT / path).read_text()


def test_shared_layers_do_not_branch_on_modal_identity():
    shared_paths = [
        "backend/agents/models.py",
        "backend/agents/services/lifecycle.py",
        "backend/agents/services/machine_write.py",
        "backend/agents/services/runtime_segments.py",
    ]

    forbidden = [
        'runtime == "modal"',
        "get_runtime(\"modal\")",
        "from agents.runtimes.modal import",
    ]

    for path in shared_paths:
        source = _read(path)
        for needle in forbidden:
            assert needle not in source, f"{path} still leaks Modal identity via {needle!r}"
