"""Generate docs/AGENT-REFERENCE.md from agent codebase.

Walks agent/{runtime,transports,contracts,platform}/**/*.py, extracts module
docstrings, test class docstrings, and # intentional: / # tech-debt: annotations.
Mirrors the backend pattern in generate_reference.py.

Usage:
    python agent/scripts/generate-reference.py
"""

import ast
import re
import sys
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
AGENT_DIR = SCRIPT_DIR.parent
REPO_ROOT = AGENT_DIR.parent
OUTPUT_PATH = REPO_ROOT / "docs" / "AGENT-REFERENCE.md"

SCAN_DIRS = ["runtime", "transports", "contracts", "platform"]
SKIP_DIRS = {"__pycache__", ".venv", "node_modules"}


@dataclass
class DocChunk:
    title: str
    content: str
    source: str
    chunk_type: str  # "module" | "test_principle" | "annotation" | "tech_debt"


def _rel(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _should_walk(path: Path) -> bool:
    return not any(part in SKIP_DIRS for part in path.parts)


def _extract_module_docstrings() -> list[DocChunk]:
    chunks = []
    for subdir in SCAN_DIRS:
        scan_path = AGENT_DIR / subdir
        if not scan_path.is_dir():
            continue
        for py_file in sorted(scan_path.rglob("*.py")):
            if not _should_walk(py_file):
                continue
            if py_file.name == "__init__.py":
                src = py_file.read_text(encoding="utf-8").strip()
                if not src:
                    continue
            try:
                tree = ast.parse(py_file.read_text(encoding="utf-8"))
            except SyntaxError:
                continue
            docstring = ast.get_docstring(tree)
            if not docstring:
                continue
            rel = _rel(py_file)
            chunks.append(DocChunk(
                title=rel, content=docstring.strip(),
                source=f"{rel}:1", chunk_type="module",
            ))
    return chunks


def _extract_test_principles() -> list[DocChunk]:
    chunks = []
    tests_dir = AGENT_DIR / "tests"
    if not tests_dir.is_dir():
        return chunks
    for py_file in sorted(tests_dir.glob("test_*.py")):
        try:
            tree = ast.parse(py_file.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            docstring = ast.get_docstring(node)
            if not docstring:
                continue
            rel_file = py_file.name
            chunks.append(DocChunk(
                title=f"{rel_file} — {node.name}",
                content=docstring.strip(),
                source=f"agent/tests/{rel_file}:{node.lineno}",
                chunk_type="test_principle",
            ))
    return chunks


def _extract_annotations() -> list[DocChunk]:
    pattern = re.compile(r"#\s*(intentional|tech-debt):\s*(.+)")
    chunks = []
    for subdir in SCAN_DIRS:
        scan_path = AGENT_DIR / subdir
        if not scan_path.is_dir():
            continue
        for py_file in sorted(scan_path.rglob("*.py")):
            if not _should_walk(py_file) or "tests" in py_file.parts:
                continue
            src = py_file.read_text(encoding="utf-8")
            lines = src.splitlines()
            rel = _rel(py_file)

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
                match = pattern.search(line)
                if match:
                    tag = match.group(1)
                    chunk_type = "annotation" if tag == "intentional" else "tech_debt"
                    chunks.append(DocChunk(
                        title=f"{py_file.name}:{i}",
                        content=match.group(2).strip(),
                        source=f"{rel}:{i}",
                        chunk_type=chunk_type,
                    ))
    return chunks


def _render_markdown(chunks: list[DocChunk]) -> str:
    lines = [
        "# Agentobox Agent Reference",
        "",
        "> Auto-generated from agent codebase. Do not edit — regenerate with `make docs`.",
        "",
    ]

    modules = [c for c in chunks if c.chunk_type == "module"]
    if modules:
        lines.append("## Modules")
        lines.append("")
        for chunk in modules:
            lines.append(f"### {chunk.title}")
            lines.append("")
            lines.append(chunk.content)
            lines.append("")

    principles = [c for c in chunks if c.chunk_type == "test_principle"]
    if principles:
        lines.append("## Test Principles")
        lines.append("")
        for chunk in principles:
            lines.append(f"### {chunk.title}")
            lines.append("")
            lines.append(chunk.content)
            lines.append("")

    annotations = [c for c in chunks if c.chunk_type == "annotation"]
    if annotations:
        lines.append("## Exception Annotations")
        lines.append("")
        lines.append("| File | Line | Annotation |")
        lines.append("|------|------|------------|")
        for chunk in annotations:
            parts = chunk.title.split(":")
            fname = parts[0]
            lineno = parts[1] if len(parts) > 1 else "?"
            lines.append(f"| {fname} | {lineno} | {chunk.content} |")
        lines.append("")

    tech_debt = [c for c in chunks if c.chunk_type == "tech_debt"]
    if tech_debt:
        lines.append("## Tech Debt")
        lines.append("")
        lines.append("| File | Line | Annotation |")
        lines.append("|------|------|------------|")
        for chunk in tech_debt:
            parts = chunk.title.split(":")
            fname = parts[0]
            lineno = parts[1] if len(parts) > 1 else "?"
            lines.append(f"| {fname} | {lineno} | {chunk.content} |")
        lines.append("")

    return "\n".join(lines)


def main():
    chunks = []
    chunks.extend(_extract_module_docstrings())
    chunks.extend(_extract_test_principles())
    chunks.extend(_extract_annotations())
    content = _render_markdown(chunks)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(content, encoding="utf-8")

    counts = {}
    for c in chunks:
        counts[c.chunk_type] = counts.get(c.chunk_type, 0) + 1
    parts = [f"{v} {k}s" for k, v in sorted(counts.items())]
    print(f"Wrote {OUTPUT_PATH} ({len(chunks)} chunks: {', '.join(parts)})")


if __name__ == "__main__":
    main()
