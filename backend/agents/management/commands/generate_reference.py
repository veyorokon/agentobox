"""Generate docs/REFERENCE.md from codebase docstrings and annotations.

Walks backend/agents/**/*.py and agent/rootfs/**/*.py, extracts module
docstrings, test class docstrings (as principles), # intentional: annotations,
and # tech-debt: annotations. Renders a single markdown file for LLM consumption.

Usage:
    docker compose exec backend uv run python manage.py generate_reference
"""

import ast
import re
from dataclasses import dataclass
from pathlib import Path

from django.core.management.base import BaseCommand

AGENTS_DIR = Path(__file__).resolve().parent.parent.parent  # backend/agents/
BACKEND_DIR = AGENTS_DIR.parent  # backend/ (or /app in Docker)

# In Docker: backend is /app, but agent/ and docs/ are mounted at repo
# root (/) via docker-compose volumes. Locally: backend/ is under repo root.
if (BACKEND_DIR / "manage.py").exists() and not (BACKEND_DIR / "docs").exists():
    # Docker: /app has manage.py but docs/ is at /docs/ (repo root = /)
    # Walk up until we find docs/ or hit root
    p = BACKEND_DIR.parent
    while p != p.parent:
        if (p / "docs").is_dir():
            break
        p = p.parent
    REPO_ROOT = p
else:
    # Local: backend/ is under repo root
    REPO_ROOT = BACKEND_DIR.parent

AGENT_ROOTFS_DIR = REPO_ROOT / "agent" / "rootfs"
OUTPUT_PATH = REPO_ROOT / "docs" / "REFERENCE.md"

SKIP_DIRS = {"migrations", "__pycache__", ".venv"}


@dataclass
class DocChunk:
    title: str
    content: str
    source: str
    chunk_type: str  # "module" | "test_principle" | "annotation" | "tech_debt"


def _rel(path: Path) -> str:
    """Path relative to repo root for display."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        try:
            return str(path.relative_to(AGENTS_DIR.parent))
        except ValueError:
            return str(path)


def _should_walk(path: Path) -> bool:
    return not any(part in SKIP_DIRS for part in path.parts)


class Command(BaseCommand):
    help = "Generate docs/REFERENCE.md from codebase docstrings and annotations."

    def add_arguments(self, parser):
        parser.add_argument(
            "--to-stdout", action="store_true", dest="to_stdout",
            help="Write markdown to stdout instead of docs/REFERENCE.md",
        )

    def handle(self, **options):
        chunks = []
        chunks.extend(self._extract_module_docstrings())
        chunks.extend(self._extract_test_principles())
        chunks.extend(self._extract_annotations())
        content = self._render_markdown(chunks)
        if options["to_stdout"]:
            self.stdout.write(content)
        else:
            OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
            OUTPUT_PATH.write_text(content, encoding="utf-8")
            self.stderr.write(f"Wrote {OUTPUT_PATH} ({len(chunks)} chunks)")

    def _extract_module_docstrings(self) -> list[DocChunk]:
        """Walk backend/agents/**/*.py, yield DocChunk per module docstring."""
        chunks = []
        for py_file in sorted(AGENTS_DIR.rglob("*.py")):
            if not _should_walk(py_file):
                continue
            if py_file.name == "__init__.py":
                # Only include __init__.py if it has a real docstring (not empty)
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
                title=rel,
                content=docstring.strip(),
                source=f"{rel}:1",
                chunk_type="module",
            ))
        return chunks

    def _extract_test_principles(self) -> list[DocChunk]:
        """Walk test files, find classes with docstrings, yield DocChunk."""
        chunks = []
        tests_dir = AGENTS_DIR / "tests"
        if not tests_dir.exists():
            return chunks

        for py_file in sorted(tests_dir.glob("test_*.py")):
            try:
                src = py_file.read_text(encoding="utf-8")
                tree = ast.parse(src)
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
                    source=f"agents/tests/{rel_file}:{node.lineno}",
                    chunk_type="test_principle",
                ))
        return chunks

    def _extract_annotations(self) -> list[DocChunk]:
        """Walk all .py files, find # intentional: and # tech-debt: comments."""
        pattern = re.compile(r"#\s*(intentional|tech-debt):\s*(.+)")
        chunks = []
        search_dirs = [AGENTS_DIR]
        if AGENT_ROOTFS_DIR.is_dir():
            search_dirs.append(AGENT_ROOTFS_DIR)

        for search_dir in search_dirs:
            for py_file in sorted(search_dir.rglob("*.py")):
                if not _should_walk(py_file):
                    continue
                # Skip test files for annotation extraction
                if "tests" in py_file.parts:
                    continue

                src = py_file.read_text(encoding="utf-8")
                lines = src.splitlines()
                rel = _rel(py_file)

                # Find lines inside string literals (docstrings, etc.) so we skip them
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

    def _render_markdown(self, chunks: list[DocChunk]) -> str:
        """Render chunks to markdown string."""
        lines = [
            "# Agentobox Backend Reference",
            "",
            "> Auto-generated from codebase. Do not edit — regenerate with `make docs`.",
            "",
        ]

        # Module docstrings
        modules = [c for c in chunks if c.chunk_type == "module"]
        if modules:
            lines.append("## Modules")
            lines.append("")
            for chunk in modules:
                lines.append(f"### {chunk.title}")
                lines.append("")
                lines.append(chunk.content)
                lines.append("")

        # Test principles
        principles = [c for c in chunks if c.chunk_type == "test_principle"]
        if principles:
            lines.append("## Test Principles")
            lines.append("")
            for chunk in principles:
                lines.append(f"### {chunk.title}")
                lines.append("")
                lines.append(chunk.content)
                lines.append("")

        # Exception annotations
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

        # Tech debt annotations
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
