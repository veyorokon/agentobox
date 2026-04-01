from __future__ import annotations

import sys
from pathlib import Path


def bootstrap_local_libs() -> None:
    """Make internal src-layout libraries importable from backend entrypoints."""
    backend_dir = Path(__file__).resolve().parent.parent
    repo_root = backend_dir.parent
    lib_src = repo_root / "libs" / "gda_kernel" / "src"
    lib_path = str(lib_src)
    if lib_src.exists() and lib_path not in sys.path:
        sys.path.insert(0, lib_path)
