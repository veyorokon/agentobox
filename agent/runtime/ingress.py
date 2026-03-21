from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from agent.provisioning.manifest import CANONICAL_PATHS
from agent.runtime.health import livez_payload, readyz_payload


class LocalIngressServer:
    def __init__(self, host: str, port: int, app):
        self._app = app
        self._server = ThreadingHTTPServer((host, port), self._make_handler())
        self.host, self.port = self._server.server_address

    def _make_handler(self) -> type[BaseHTTPRequestHandler]:
        app = self._app

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                if self.path == "/livez":
                    self._write_json(HTTPStatus.OK, livez_payload())
                    return
                if self.path in {"/readyz", "/healthz"}:
                    code, payload = readyz_payload(app.status())
                    self._write_json(code, payload)
                    return
                if self.path == "/status":
                    self._write_json(HTTPStatus.OK, app.status().to_dict())
                    return
                if self.path == "/browser-home":
                    self._write_text(
                        HTTPStatus.OK,
                        (app.config.root_dir / CANONICAL_PATHS["browser_home_html"]).read_text(),
                        content_type="text/html; charset=utf-8",
                        cache_control="no-store",
                    )
                    return
                if self.path == "/theme.css":
                    self._write_text(
                        HTTPStatus.OK,
                        (app.config.root_dir / CANONICAL_PATHS["theme_css"]).read_text(),
                        content_type="text/css; charset=utf-8",
                        cache_control="no-store",
                    )
                    return
                if self.path == "/theme.json":
                    self._write_text(
                        HTTPStatus.OK,
                        (app.config.root_dir / CANONICAL_PATHS["theme_json"]).read_text(),
                        content_type="application/json; charset=utf-8",
                        cache_control="no-store",
                    )
                    return
                if self.path.startswith("/tasks/"):
                    task_id = self.path.rsplit("/", 1)[-1]
                    task = app.get_task(task_id)
                    if not task:
                        self._write_json(HTTPStatus.NOT_FOUND, {"error": "task_not_found"})
                        return
                    self._write_json(HTTPStatus.OK, task.to_dict())
                    return
                self._write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

            def do_POST(self) -> None:
                if self.path != "/tasks":
                    self._write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                    return

                payload = self._read_json()
                input_text = (payload.get("input") or "").strip()
                if not input_text:
                    self._write_json(HTTPStatus.BAD_REQUEST, {"error": "input_required"})
                    return

                task = app.submit_task(input_text)
                self._write_json(HTTPStatus.ACCEPTED, task.to_dict())

            def log_message(self, format: str, *args) -> None:
                return

            def _read_json(self) -> dict:
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length) if length else b"{}"
                return json.loads(raw.decode("utf-8"))

            def _write_json(self, status: int, payload: dict) -> None:
                body = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _write_text(
                self,
                status: int,
                payload: str,
                *,
                content_type: str,
                cache_control: str | None = None,
            ) -> None:
                body = payload.encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                if cache_control:
                    self.send_header("Cache-Control", cache_control)
                self.end_headers()
                self.wfile.write(body)

        return Handler

    def start(self) -> None:
        import threading

        thread = threading.Thread(target=self._server.serve_forever, name="agent-http", daemon=True)
        thread.start()
        self._thread = thread

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        thread = getattr(self, "_thread", None)
        if thread:
            thread.join(timeout=2)
