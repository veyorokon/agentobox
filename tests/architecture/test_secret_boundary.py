"""Secret boundary invariants.

The BYOK security model has a hard boundary:

  Real API key → /run/secrets/proxy_key (root:root 0600)
                  ↓
  api-proxy.py (root) reads it, injects into upstream requests
                  ↓
  relay.py + Claude Code only see a placeholder key via env var

These tests enforce:
  1. Only api-proxy.py reads the real key path (/run/secrets/proxy_key)
  2. relay.py never reads secret files — only passes env vars through
  3. Backend only writes placeholder keys to relay env, real keys to proxy_key
  4. No hardcoded API key patterns in agent image files

Cross-boundary: reads both backend and agent source files.
No Django dependency — pure file reads.
"""

import re

from ._paths import AGENT_DIR, AGENT_PY_ROOTS, BACKEND_DIR

BACKEND_ADAPTER_DIR = BACKEND_DIR / "agents" / "adapters" / "claude_code"

# Paths inside the container where secrets live
SECRET_KEY_PATH = "/run/secrets/proxy_key"

# Files that are ALLOWED to reference the secret key path
SECRET_PATH_ALLOWLIST = {"api-proxy.py"}


# ---------------------------------------------------------------------------
# 1. Only api-proxy.py reads the real key path
# ---------------------------------------------------------------------------

class TestRealKeyIsolation:
    """The real API key file must only be read by the api-proxy process."""

    def test_only_api_proxy_reads_secret_key_path(self):
        """No agent-side Python file other than api-proxy.py should reference
        /run/secrets/proxy_key. The relay and Claude Code must never touch it."""
        violators = []
        for root in AGENT_PY_ROOTS:
            if not root.exists():
                continue
            for f in root.rglob("*.py"):
                if f.name in SECRET_PATH_ALLOWLIST:
                    continue
                source = f.read_text()
                if SECRET_KEY_PATH in source or "proxy_key" in source:
                    violators.append(f"{f.relative_to(AGENT_DIR)}")
        assert not violators, (
            f"Files referencing {SECRET_KEY_PATH}: {violators}. "
            f"Only api-proxy.py should read the real API key."
        )

    def test_relay_sdk_env_only_passes_env_vars(self):
        """_build_sdk_env() must only read from os.environ, never from files.
        It should not open(), read(), or reference /run/secrets/."""
        relay_path = AGENT_DIR / "claude" / "rootfs" / "opt" / "abox" / "relay.py"
        source = relay_path.read_text()

        # Extract the _build_sdk_env method body
        match = re.search(
            r'def _build_sdk_env\(.*?\).*?:\n(.*?)(?=\n    def |\nclass )',
            source,
            re.DOTALL,
        )
        assert match, "_build_sdk_env() not found in relay.py"
        method_body = match.group(1)

        # Must not contain file I/O or secret path references
        forbidden = [
            (r'open\s*\(', "opens a file"),
            (r'read_text\s*\(', "reads a file"),
            (r'/run/secrets/', "references secret path"),
            (r'proxy_key', "references proxy key file"),
        ]
        violations = []
        for pattern, reason in forbidden:
            if re.search(pattern, method_body):
                violations.append(reason)
        assert not violations, (
            f"_build_sdk_env() {', '.join(violations)}. "
            f"It must only pass env vars, never read secret files."
        )


# ---------------------------------------------------------------------------
# 2. Backend writes real key only to proxy_key, placeholder to relay env
# ---------------------------------------------------------------------------

class TestBackendKeyRouting:
    """The backend adapter must route real keys to /run/secrets/ and
    only placeholders to the relay environment."""

    def test_relay_env_uses_placeholder_not_real_key(self):
        """build_relay_env() must only emit the placeholder key constant,
        never the raw api_key parameter value, for ANTHROPIC_API_KEY."""
        adapter_init = BACKEND_ADAPTER_DIR / "__init__.py"
        source = adapter_init.read_text()

        # Find build_relay_env method
        match = re.search(
            r'def build_relay_env\(.*?\).*?:\n(.*?)(?=\n    def |\nclass )',
            source,
            re.DOTALL,
        )
        assert match, "build_relay_env() not found in adapter"
        method_body = match.group(1)

        # The ANTHROPIC_API_KEY line must reference the placeholder constant
        key_lines = [
            line for line in method_body.split('\n')
            if 'ANTHROPIC_API_KEY' in line and 'export' in line.lower()
        ]
        assert key_lines, "No ANTHROPIC_API_KEY export found in build_relay_env"

        for line in key_lines:
            assert '_PROXY_PLACEHOLDER_KEY' in line or 'placeholder' in line.lower(), (
                f"ANTHROPIC_API_KEY export uses raw key instead of placeholder: {line.strip()}"
            )

    def test_real_key_only_written_to_secret_path(self):
        """build_api_key_files() must write the real api_key only to
        /run/secrets/proxy_key with restrictive permissions."""
        adapter_init = BACKEND_ADAPTER_DIR / "__init__.py"
        source = adapter_init.read_text()

        # The real key content should only appear paired with the secret path
        match = re.search(
            r'def build_api_key_files\(.*?\).*?:\n(.*?)(?=\n    def |\nclass )',
            source,
            re.DOTALL,
        )
        assert match, "build_api_key_files() not found in adapter"
        method_body = match.group(1)

        # Find file specs that use "content": api_key (the raw key)
        # They must have path == _PROXY_KEY_PATH and mode 0600
        key_content_matches = list(re.finditer(
            r'"content"\s*:\s*api_key', method_body
        ))
        assert key_content_matches, (
            "No file spec writes the raw api_key — "
            "expected exactly one for /run/secrets/proxy_key"
        )

        # Each raw key write must be paired with the proxy key path
        for m in key_content_matches:
            # Look at surrounding context (the dict this belongs to)
            start = method_body.rfind('{', 0, m.start())
            end = method_body.find('}', m.end())
            spec_block = method_body[start:end + 1] if start >= 0 and end >= 0 else ""
            assert '_PROXY_KEY_PATH' in spec_block or 'proxy_key' in spec_block, (
                "Raw api_key is written to a path other than /run/secrets/proxy_key"
            )
            assert '"0600"' in spec_block, (
                "Raw api_key file must have mode 0600 (root-only read)"
            )


# ---------------------------------------------------------------------------
# 3. No hardcoded secrets in agent image files
# ---------------------------------------------------------------------------

class TestNoHardcodedSecrets:
    """Agent image source files must not contain hardcoded API keys."""

    # Patterns that look like real API keys (not placeholders or test fixtures)
    API_KEY_PATTERNS = [
        (r'sk-ant-api\d{2}-[A-Za-z0-9]{20,}', "Anthropic API key"),
        (r'sk-[A-Za-z0-9]{40,}', "OpenAI-style API key"),
        (r'gsk_[A-Za-z0-9]{40,}', "Groq API key"),
    ]

    def test_no_real_api_keys_in_agent_files(self):
        """No agent-side file should contain a real API key pattern."""
        violations = []
        for root in AGENT_PY_ROOTS:
            if not root.exists():
                continue
            for f in root.rglob("*.py"):
                source = f.read_text()
                for pattern, key_type in self.API_KEY_PATTERNS:
                    matches = re.findall(pattern, source)
                    for match in matches:
                        # Skip the known placeholder
                        if "placeholder" in match.lower():
                            continue
                        violations.append(
                            f"{f.relative_to(AGENT_DIR)}: {key_type} ({match[:20]}...)"
                        )
        assert not violations, (
            "Hardcoded API keys found in agent files:\n"
            + "\n".join(f"  {v}" for v in violations)
        )
