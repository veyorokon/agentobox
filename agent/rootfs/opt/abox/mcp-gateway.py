#!/usr/bin/env python3
"""
MCP Gateway — manages MCP server subprocesses with secret isolation.

Reads /run/mcp-gateway/config.json for server definitions.
Spawns each MCP as a stdio subprocess with scoped env from /run/secrets/mcp-<name>/.
Bridges stdio↔HTTP on localhost:<port> per server.
Reloads on SIGHUP (re-reads config, starts new servers, stops removed ones).

Runs as root (to read secret dirs), spawns MCP subprocesses as `agent` user via
pwd.getpwnam + subprocess.Popen(user=, group=, env=).

Config format (/run/mcp-gateway/config.json):
{
    "servers": {
        "playwright": {
            "command": "npx",
            "args": ["@playwright/mcp@latest"],
            "port": 7001
        }
    }
}

Secret dirs: /run/secrets/mcp-<name>/<KEY> — each file contains one secret value.
Only secrets listed in the MCP's registry entry are written to its secret dir.
"""

import http.server
import json
import os
import pwd
import signal
import subprocess
import sys
import threading
import time

from abox_logging import setup_redacted_logging

_log, _redactor = setup_redacted_logging("abox-mcp-gateway")

CONFIG_PATH = "/run/mcp-gateway/config.json"
SECRETS_BASE = "/run/secrets"
AGENT_USER = "agent"

# Exponential backoff for crashed subprocesses
MAX_RETRIES = 5
INITIAL_BACKOFF = 1.0  # seconds
MAX_BACKOFF = 30.0


def _load_config() -> dict:
    """Load gateway config from CONFIG_PATH. Returns {"servers": {...}}."""
    try:
        with open(CONFIG_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        _log.error("gateway.config_load_failed", extra={"path": CONFIG_PATH, "error": str(exc)})
        return {"servers": {}}


def _load_secrets(name: str) -> dict:
    """Load scoped secrets from /run/secrets/mcp-<name>/. Returns {KEY: value}."""
    secret_dir = os.path.join(SECRETS_BASE, f"mcp-{name}")
    env = {}
    if not os.path.isdir(secret_dir):
        return env
    for filename in os.listdir(secret_dir):
        filepath = os.path.join(secret_dir, filename)
        if os.path.isfile(filepath):
            try:
                with open(filepath) as f:
                    env[filename] = f.read().strip()
            except (PermissionError, OSError) as exc:
                _log.warning("gateway.secret_read_failed", extra={"file": filepath, "error": str(exc)})
    return env


def _agent_uid_gid() -> tuple:
    """Get UID and GID for the agent user."""
    pw = pwd.getpwnam(AGENT_USER)
    return pw.pw_uid, pw.pw_gid


class MCPBridge:
    """Manages a single MCP server subprocess and its HTTP bridge."""

    def __init__(self, name, command, args, port):
        self.name = name
        self.command = command
        self.args = args
        self.port = port
        self.process = None
        self.http_server = None
        self.http_thread = None
        self._lock = threading.Lock()
        self._retries = 0
        self._stopping = False
        self._monitor_thread = None

    def start(self):
        """Start the MCP subprocess and HTTP bridge."""
        self._stopping = False
        self._spawn_process()
        self._start_http()
        self._monitor_thread = threading.Thread(target=self._monitor, daemon=True)
        self._monitor_thread.start()
        _log.info("gateway.mcp_started", extra={"server": self.name, "port": self.port, "command": self.command})

    def _spawn_process(self):
        """Spawn the MCP subprocess as the agent user."""
        uid, gid = _agent_uid_gid()
        # Build env: inherit minimal env + scoped secrets
        env = {
            "HOME": "/home/agent",
            "USER": AGENT_USER,
            "PATH": os.environ.get("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"),
            "DISPLAY": os.environ.get("DISPLAY", ":1"),
            "NODE_PATH": os.environ.get("NODE_PATH", ""),
            "TERM": "xterm-256color",
        }
        # Merge scoped secrets
        env.update(_load_secrets(self.name))
        # Remove empty values
        env = {k: v for k, v in env.items() if v}

        self.process = subprocess.Popen(
            [self.command] + self.args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            user=uid,
            group=gid,
            env=env,
            cwd="/home/agent",
        )

    def _start_http(self):
        """Start HTTP server that bridges requests to the MCP subprocess."""
        bridge = self

        class BridgeHandler(http.server.BaseHTTPRequestHandler):
            def log_request(self, code="-", size="-"):
                pass

            def do_POST(self):
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length) if content_length > 0 else b""
                response = bridge._handle_jsonrpc(body)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(response)))
                self.end_headers()
                self.wfile.write(response)

            def do_GET(self):
                # Health check
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"ok")

            def do_DELETE(self):
                # SSE session cleanup — no-op for stdio bridge
                self.send_response(200)
                self.end_headers()

        self.http_server = http.server.ThreadingHTTPServer(("127.0.0.1", self.port), BridgeHandler)
        self.http_thread = threading.Thread(target=self.http_server.serve_forever, daemon=True)
        self.http_thread.start()

    def _handle_jsonrpc(self, body):
        """Write JSON-RPC request to subprocess stdin, read response from stdout."""
        with self._lock:
            proc = self.process
            if not proc or proc.poll() is not None:
                error_resp = {
                    "jsonrpc": "2.0",
                    "error": {"code": -32603, "message": f"MCP server '{self.name}' is not running"},
                    "id": None,
                }
                try:
                    req = json.loads(body)
                    error_resp["id"] = req.get("id")
                except (json.JSONDecodeError, KeyError):
                    pass
                return json.dumps(error_resp).encode("utf-8")

            try:
                # Write request + newline delimiter
                proc.stdin.write(body + b"\n")
                proc.stdin.flush()

                # Read response line (JSON-RPC over stdio uses newline-delimited JSON)
                response_line = proc.stdout.readline()
                if not response_line:
                    raise IOError("MCP subprocess closed stdout")
                return response_line.strip()
            except (BrokenPipeError, IOError, OSError) as exc:
                _log.error("gateway.mcp_io_error", extra={"server": self.name, "error": str(exc)})
                error_resp = {
                    "jsonrpc": "2.0",
                    "error": {"code": -32603, "message": f"I/O error: {exc}"},
                    "id": None,
                }
                try:
                    req = json.loads(body)
                    error_resp["id"] = req.get("id")
                except (json.JSONDecodeError, KeyError):
                    pass
                return json.dumps(error_resp).encode("utf-8")

    def _monitor(self):
        """Monitor subprocess and restart on crash with exponential backoff."""
        while not self._stopping:
            if self.process and self.process.poll() is not None:
                exit_code = self.process.returncode
                _log.warning("gateway.mcp_crashed", extra={
                    "server": self.name, "exit_code": exit_code, "retries": self._retries,
                })
                if self._retries >= MAX_RETRIES:
                    _log.error("gateway.mcp_max_retries", extra={"server": self.name})
                    break
                backoff = min(INITIAL_BACKOFF * (2 ** self._retries), MAX_BACKOFF)
                self._retries += 1
                time.sleep(backoff)
                if not self._stopping:
                    try:
                        self._spawn_process()
                        _log.info("gateway.mcp_restarted", extra={"server": self.name, "retry": self._retries})
                    except Exception as exc:
                        _log.error("gateway.mcp_restart_failed", extra={"server": self.name, "error": str(exc)})
            else:
                # Reset retry counter on healthy run (process alive for >30s)
                if self._retries > 0 and self.process and self.process.poll() is None:
                    self._retries = 0
            time.sleep(2)

    def stop(self):
        """Stop the MCP subprocess and HTTP server."""
        self._stopping = True
        if self.http_server:
            self.http_server.shutdown()
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2)
        _log.info("gateway.mcp_stopped", extra={"server": self.name})


class MCPGateway:
    """Manages all MCP server bridges. Supports reload via SIGHUP."""

    def __init__(self):
        self.bridges = {}
        self._shutdown = threading.Event()

    def load_and_start(self):
        """Load config and start all MCP bridges."""
        config = _load_config()
        servers = config.get("servers", {})
        for name, srv in servers.items():
            if name in self.bridges:
                continue
            bridge = MCPBridge(
                name=name,
                command=srv["command"],
                args=srv.get("args", []),
                port=srv["port"],
            )
            try:
                bridge.start()
                self.bridges[name] = bridge
            except Exception as exc:
                _log.error("gateway.mcp_start_failed", extra={"server": name, "error": str(exc)})

    def reload(self):
        """Reload config: start new servers, stop removed ones."""
        _log.info("gateway.reloading")
        config = _load_config()
        new_servers = config.get("servers", {})
        current_names = set(self.bridges.keys())
        new_names = set(new_servers.keys())

        # Stop removed servers
        for name in current_names - new_names:
            self.bridges[name].stop()
            del self.bridges[name]

        # Start new servers
        for name in new_names - current_names:
            srv = new_servers[name]
            bridge = MCPBridge(
                name=name,
                command=srv["command"],
                args=srv.get("args", []),
                port=srv["port"],
            )
            try:
                bridge.start()
                self.bridges[name] = bridge
            except Exception as exc:
                _log.error("gateway.mcp_start_failed", extra={"server": name, "error": str(exc)})

        _log.info("gateway.reloaded", extra={"active": list(self.bridges.keys())})

    def shutdown(self):
        """Stop all bridges."""
        _log.info("gateway.shutting_down")
        for bridge in self.bridges.values():
            bridge.stop()
        self.bridges.clear()
        self._shutdown.set()

    def wait(self):
        """Block until shutdown."""
        self._shutdown.wait()


def main():
    gateway = MCPGateway()

    def handle_sighup(signum, frame):
        gateway.reload()

    def handle_sigterm(signum, frame):
        gateway.shutdown()

    signal.signal(signal.SIGHUP, handle_sighup)
    signal.signal(signal.SIGTERM, handle_sigterm)

    _log.info("gateway.starting")
    gateway.load_and_start()
    _log.info("gateway.started", extra={"servers": list(gateway.bridges.keys())})

    gateway.wait()


if __name__ == "__main__":
    main()
