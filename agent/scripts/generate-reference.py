"""Generate docs/AGENT-REFERENCE.md from agent codebase docstrings and annotations.

Walks agent/rootfs/**/*.py, agent/claude/rootfs/**/*.py, agent/tests/test_*.py,
and agent/rootfs/etc/s6-overlay/ shell scripts. Extracts module docstrings,
test class docstrings, # intentional: / # tech-debt: annotations, shell script
headers, and s6 service inventory.

Usage:
    python agent/scripts/generate-reference.py            # writes docs/AGENT-REFERENCE.md
    python agent/scripts/generate-reference.py --to-stdout # writes to stdout
"""

import ast
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
AGENT_DIR = REPO_ROOT / "agent"
OUTPUT_PATH = REPO_ROOT / "docs" / "AGENT-REFERENCE.md"

PYTHON_DIRS = [
    AGENT_DIR / "rootfs",
    AGENT_DIR / "claude" / "rootfs",
]
TESTS_DIR = AGENT_DIR / "tests"
S6_DIR = AGENT_DIR / "rootfs" / "etc" / "s6-overlay"
S6_RC_DIR = S6_DIR / "s6-rc.d"
S6_SCRIPTS_DIR = S6_DIR / "scripts"

SKIP_DIRS = {"__pycache__", ".venv", "node_modules"}

ANNOTATION_RE = re.compile(r"#\s*(intentional|tech-debt):\s*(.+)")


@dataclass
class DocChunk:
    title: str
    content: str
    source: str
    chunk_type: str  # "module" | "test_principle" | "annotation" | "tech_debt" | "shell"


@dataclass
class S6Service:
    name: str
    svc_type: str  # "oneshot" | "longrun"
    dependencies: list[str] = field(default_factory=list)
    header: str = ""  # first comment block from run/up script


def _rel(path: Path) -> str:
    """Path relative to repo root for display."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _should_walk(path: Path) -> bool:
    return not any(part in SKIP_DIRS for part in path.parts)


# ---------------------------------------------------------------------------
# Python module docstrings
# ---------------------------------------------------------------------------

def extract_module_docstrings() -> list[DocChunk]:
    """Walk agent Python dirs, yield DocChunk per module docstring."""
    chunks = []
    for search_dir in PYTHON_DIRS:
        if not search_dir.is_dir():
            continue
        for py_file in sorted(search_dir.rglob("*.py")):
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
                title=rel,
                content=docstring.strip(),
                source=f"{rel}:1",
                chunk_type="module",
            ))
    return chunks


# ---------------------------------------------------------------------------
# Test principles
# ---------------------------------------------------------------------------

def extract_test_principles() -> list[DocChunk]:
    """Walk test files, find classes with docstrings, yield DocChunk."""
    chunks = []
    if not TESTS_DIR.exists():
        return chunks

    for py_file in sorted(TESTS_DIR.glob("test_*.py")):
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
                source=f"agent/tests/{rel_file}:{node.lineno}",
                chunk_type="test_principle",
            ))
    return chunks


# ---------------------------------------------------------------------------
# Annotations (# intentional: / # tech-debt:)
# ---------------------------------------------------------------------------

def extract_annotations() -> list[DocChunk]:
    """Walk all agent .py files, find # intentional: and # tech-debt: comments."""
    chunks = []
    for search_dir in PYTHON_DIRS:
        if not search_dir.is_dir():
            continue
        for py_file in sorted(search_dir.rglob("*.py")):
            if not _should_walk(py_file):
                continue
            if "tests" in py_file.parts:
                continue

            src = py_file.read_text(encoding="utf-8")
            lines = src.splitlines()
            rel = _rel(py_file)

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
                match = ANNOTATION_RE.search(line)
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


# ---------------------------------------------------------------------------
# Shell script headers
# ---------------------------------------------------------------------------

def _extract_shell_header(path: Path) -> str:
    """Extract the first comment block after the shebang from a shell script.

    Returns the comment text (without leading #) or empty string.
    """
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return ""

    header_lines = []
    past_shebang = False
    past_redirects = False

    for line in lines:
        stripped = line.strip()

        # Skip shebang
        if not past_shebang:
            if stripped.startswith("#!"):
                past_shebang = True
                continue
            # No shebang — treat first line as content
            past_shebang = True

        # Skip `exec 2>&1` and blank lines before the comment block
        if not past_redirects:
            if stripped == "" or stripped.startswith("exec 2>&1"):
                continue
            past_redirects = True

        # Collect comment lines
        if stripped.startswith("#"):
            # Strip leading # and one optional space
            text = stripped[1:]
            if text.startswith(" "):
                text = text[1:]
            header_lines.append(text)
        else:
            # First non-comment line ends the header block
            break

    return "\n".join(header_lines).strip()


def extract_shell_headers() -> list[DocChunk]:
    """Extract header comments from s6 run/finish scripts and init scripts."""
    chunks = []

    # s6-rc.d service run/finish scripts
    if S6_RC_DIR.is_dir():
        for svc_dir in sorted(S6_RC_DIR.iterdir()):
            if not svc_dir.is_dir():
                continue
            for script_name in ("run", "finish"):
                script = svc_dir / script_name
                if not script.is_file():
                    continue
                header = _extract_shell_header(script)
                if header:
                    rel = _rel(script)
                    chunks.append(DocChunk(
                        title=rel,
                        content=header,
                        source=f"{rel}:1",
                        chunk_type="shell",
                    ))

    # s6-overlay/scripts/ init scripts
    if S6_SCRIPTS_DIR.is_dir():
        for script in sorted(S6_SCRIPTS_DIR.iterdir()):
            if not script.is_file():
                continue
            header = _extract_shell_header(script)
            if header:
                rel = _rel(script)
                chunks.append(DocChunk(
                    title=rel,
                    content=header,
                    source=f"{rel}:1",
                    chunk_type="shell",
                ))

    # .sh files under agent/claude/rootfs/
    claude_rootfs = AGENT_DIR / "claude" / "rootfs"
    if claude_rootfs.is_dir():
        for sh_file in sorted(claude_rootfs.rglob("*.sh")):
            if not _should_walk(sh_file):
                continue
            header = _extract_shell_header(sh_file)
            if header:
                rel = _rel(sh_file)
                chunks.append(DocChunk(
                    title=rel,
                    content=header,
                    source=f"{rel}:1",
                    chunk_type="shell",
                ))

    return chunks


# ---------------------------------------------------------------------------
# s6 service inventory
# ---------------------------------------------------------------------------

def extract_s6_services() -> list[S6Service]:
    """List all s6 services with type, dependencies, and run script header."""
    services = []
    if not S6_RC_DIR.is_dir():
        return services

    for svc_dir in sorted(S6_RC_DIR.iterdir()):
        if not svc_dir.is_dir():
            continue
        type_file = svc_dir / "type"
        if not type_file.is_file():
            continue

        svc_type = type_file.read_text(encoding="utf-8").strip()
        name = svc_dir.name

        # Dependencies
        deps_dir = svc_dir / "dependencies.d"
        deps = sorted(d.name for d in deps_dir.iterdir()) if deps_dir.is_dir() else []

        # Header from run script (longrun) or up script reference (oneshot)
        header = ""
        run_script = svc_dir / "run"
        up_script = svc_dir / "up"
        if run_script.is_file():
            header = _extract_shell_header(run_script)
        elif up_script.is_file():
            # Oneshot: up file contains path to the actual script
            target_path = up_script.read_text(encoding="utf-8").strip()
            # Map container path to repo path
            if target_path.startswith("/etc/s6-overlay/"):
                repo_script = AGENT_DIR / "rootfs" / target_path.lstrip("/")
                if repo_script.is_file():
                    header = _extract_shell_header(repo_script)

        services.append(S6Service(
            name=name,
            svc_type=svc_type,
            dependencies=deps,
            header=header,
        ))

    return services


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------

def render_markdown(
    chunks: list[DocChunk],
    services: list[S6Service],
) -> str:
    """Render all extracted data to markdown."""
    lines = [
        "# Agentobox Agent Reference",
        "",
        "> Auto-generated from agent codebase. Do not edit — regenerate with "
        "`python agent/scripts/generate-reference.py`.",
        "",
    ]

    # --- Modules (Python docstrings) ---
    modules = [c for c in chunks if c.chunk_type == "module"]
    if modules:
        lines.append("## Modules")
        lines.append("")
        for chunk in modules:
            lines.append(f"### {chunk.title}")
            lines.append("")
            lines.append(chunk.content)
            lines.append("")

    # --- Shell scripts ---
    shells = [c for c in chunks if c.chunk_type == "shell"]
    if shells:
        lines.append("## Shell Scripts")
        lines.append("")
        for chunk in shells:
            lines.append(f"### {chunk.title}")
            lines.append("")
            lines.append(chunk.content)
            lines.append("")

    # --- S6 Services ---
    if services:
        lines.append("## S6 Services")
        lines.append("")
        lines.append("| Service | Type | Dependencies |")
        lines.append("|---------|------|-------------|")
        for svc in services:
            deps = ", ".join(svc.dependencies) if svc.dependencies else "—"
            lines.append(f"| {svc.name} | {svc.svc_type} | {deps} |")
        lines.append("")

        # Service details (those with headers)
        services_with_headers = [s for s in services if s.header]
        if services_with_headers:
            for svc in services_with_headers:
                lines.append(f"### {svc.name}")
                lines.append("")
                lines.append(svc.header)
                lines.append("")

    # --- Test Principles ---
    principles = [c for c in chunks if c.chunk_type == "test_principle"]
    if principles:
        lines.append("## Test Principles")
        lines.append("")
        for chunk in principles:
            lines.append(f"### {chunk.title}")
            lines.append("")
            lines.append(chunk.content)
            lines.append("")

    # --- Exception Annotations ---
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

    # --- Tech Debt ---
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


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    to_stdout = "--to-stdout" in sys.argv

    chunks: list[DocChunk] = []
    chunks.extend(extract_module_docstrings())
    chunks.extend(extract_shell_headers())
    chunks.extend(extract_test_principles())
    chunks.extend(extract_annotations())
    services = extract_s6_services()

    content = render_markdown(chunks, services)

    if to_stdout:
        sys.stdout.write(content)
    else:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(content, encoding="utf-8")
        chunk_count = len(chunks) + len(services)
        print(f"Wrote {OUTPUT_PATH} ({chunk_count} entries)", file=sys.stderr)


if __name__ == "__main__":
    main()
