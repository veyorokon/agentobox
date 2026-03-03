#!/usr/bin/env python3
"""
Localhost reverse proxy that injects the real API key header.

Part of the Layer 2 secret protection (see docs/ARCHITECTURE.md "Security & Secrets").
Runs as root, reads the real key from /run/secrets/proxy_key (mode 0600 root:root)
at startup, and serves on 0.0.0.0:9999. The agent process gets a base URL pointing
to localhost:9999 with a placeholder key that passes CLI format validation but is
worthless if leaked. The proxy strips the placeholder and injects the real key before
forwarding to the upstream API.

Upstream is configurable via env vars (set by the adapter's build_relay_env()):
  PROXY_UPSTREAM_HOST  — default: api.anthropic.com
  PROXY_UPSTREAM_PORT  — default: 443
  PROXY_AUTH_HEADER    — default: x-api-key (Anthropic), or "authorization" (OpenAI)

This ensures the agent process never has access to the real API key — process-level
isolation, not just environment variable hiding.

SCOPE: All requests to this proxy get the real key injected. Only agent CLI traffic
should hit localhost:9999 (via *_BASE_URL env vars).

OPS: If the proxy enters a restart loop (visible in s6 logs), check:
  1. /run/secrets/proxy_key exists and is non-empty (provisioning issue)
  2. Port 9999 is not already in use (another process grabbed it)
  3. DNS resolution for the upstream host works (network issue)
"""

import http.client
import http.server
import os
import ssl
import sys

UPSTREAM_HOST = os.environ.get("PROXY_UPSTREAM_HOST", "api.anthropic.com")
UPSTREAM_PORT = int(os.environ.get("PROXY_UPSTREAM_PORT", "443"))
AUTH_HEADER = os.environ.get("PROXY_AUTH_HEADER", "x-api-key")
LISTEN_PORT = 9999
KEY_PATH = "/run/secrets/proxy_key"
CHUNK_SIZE = 8192

# Headers to strip from incoming requests (case-insensitive lookup).
# "host" must be stripped because the CLI sends "host: localhost:9999"
# which would create a duplicate when we set the real upstream Host.
# Auth headers are stripped because we inject the real key ourselves.
# Cloudflare returns 403 on conflicting host headers.
_STRIP_HEADERS = frozenset({"x-api-key", "authorization", "host"})


def _load_key() -> str:
    """Read the real API key from the secrets file. Crash if missing."""
    try:
        with open(KEY_PATH) as f:
            key = f.read().strip()
    except FileNotFoundError:
        print(f"FATAL: {KEY_PATH} not found — cannot start without API key", file=sys.stderr)
        sys.exit(1)
    except PermissionError:
        print(f"FATAL: cannot read {KEY_PATH} — check file permissions", file=sys.stderr)
        sys.exit(1)
    if not key:
        print(f"FATAL: {KEY_PATH} is empty", file=sys.stderr)
        sys.exit(1)
    return key


# Read key once at module load (before any requests)
_REAL_KEY = _load_key()

# Reusable SSL context for upstream connections
_SSL_CTX = ssl.create_default_context()

from abox_logging import setup as _setup_logging

_log = _setup_logging("abox-apiproxy")


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    """Reverse proxy handler that injects the real API key."""

    # Silence per-request log lines
    def log_request(self, code="-", size="-"):
        pass

    def do_GET(self):
        self._proxy()

    def do_POST(self):
        self._proxy()

    def do_PUT(self):
        self._proxy()

    def do_PATCH(self):
        self._proxy()

    def do_DELETE(self):
        self._proxy()

    def do_OPTIONS(self):
        self._proxy()

    def do_HEAD(self):
        self._proxy()

    def _proxy(self):
        # Health check endpoint for s6 readiness
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
            return

        # Read request body if present
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else None

        # Build upstream headers: strip auth headers, inject real key
        upstream_headers = {}
        for key, value in self.headers.items():
            if key.lower() not in _STRIP_HEADERS:
                upstream_headers[key] = value
        # Inject real key using the configured auth header name.
        # Anthropic: "x-api-key: sk-..."
        # OpenAI:    "Authorization: Bearer sk-..."
        if AUTH_HEADER == "authorization":
            upstream_headers[AUTH_HEADER] = f"Bearer {_REAL_KEY}"
        else:
            upstream_headers[AUTH_HEADER] = _REAL_KEY
        # Override host header for upstream
        upstream_headers["Host"] = UPSTREAM_HOST

        try:
            conn = http.client.HTTPSConnection(
                UPSTREAM_HOST, UPSTREAM_PORT, context=_SSL_CTX, timeout=300
            )
            conn.request(self.command, self.path, body=body, headers=upstream_headers)
            resp = conn.getresponse()
        except Exception as exc:
            _log.error("proxy.upstream_connect_failed", extra={
                        "method": self.command, "path": self.path, "error": str(exc)})
            self.send_response(502)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Bad Gateway: upstream connection failed")
            return

        # Log non-2xx upstream responses
        if resp.status >= 400:
            _log.warning("proxy.upstream_error", extra={
                         "status": resp.status, "method": self.command, "path": self.path})

        # Send response status
        self.send_response(resp.status)

        # Copy response headers, skip hop-by-hop headers
        _hop_by_hop = frozenset({
            "connection", "keep-alive", "proxy-authenticate",
            "proxy-authorization", "te", "trailers",
            "transfer-encoding",
        })
        for header, value in resp.getheaders():
            if header.lower() not in _hop_by_hop:
                self.send_header(header, value)
        self.end_headers()

        # Stream response body chunk-by-chunk (critical for SSE)
        while True:
            chunk = resp.read(CHUNK_SIZE)
            if not chunk:
                break
            self.wfile.write(chunk)
            self.wfile.flush()

        conn.close()


def main():
    _log.info("proxy.started", extra={"port": LISTEN_PORT, "upstream": f"{UPSTREAM_HOST}:{UPSTREAM_PORT}"})
    server = http.server.ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        _log.info("proxy.stopped")
        server.shutdown()


if __name__ == "__main__":
    main()
