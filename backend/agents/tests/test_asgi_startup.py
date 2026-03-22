import asyncio

import pytest


@pytest.mark.asyncio
async def test_http_dispatch_starts_background_services(monkeypatch):
    from config import asgi

    asgi._startup_ready = asyncio.Event()
    asgi._startup_lock = asyncio.Lock()

    started = {"reconciler": 0, "mcp": 0}

    def _ensure_reconciler_running():
        started["reconciler"] += 1

    async def _ensure_mcp_ready():
        started["mcp"] += 1

    async def _fake_django(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    monkeypatch.setattr(asgi, "ensure_reconciler_running", _ensure_reconciler_running)
    monkeypatch.setattr(asgi, "_ensure_mcp_ready", _ensure_mcp_ready)
    monkeypatch.setattr(asgi, "django_asgi_app", _fake_django)

    sent: list[dict] = []

    async def _receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def _send(message):
        sent.append(message)

    await asgi.http_dispatch({"type": "http", "path": "/"}, _receive, _send)
    await asgi.http_dispatch({"type": "http", "path": "/"}, _receive, _send)

    assert started["reconciler"] == 1
    assert started["mcp"] == 0
    assert sent[-1]["type"] == "http.response.body"
