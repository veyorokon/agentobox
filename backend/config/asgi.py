import asyncio
import os

import structlog
from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application
from django.urls import re_path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django_asgi_app = get_asgi_application()

from agents.services.mcp_coord import mcp  # noqa: E402
from agents.consumers import DashboardConsumer, RelayConsumer, TerminalConsumer, VncProxyConsumer  # noqa: E402
from agents.services.reconcile import ensure_running as ensure_reconciler_running  # noqa: E402

log = structlog.get_logger("abox.graphql")

# MCP coordination server — SSE transport.
# CC 2.x SDK connects with type="sse", so we use FastMCP's http_app(transport="sse")
# which serves the SSE stream at /mcp and message POST at /messages/.
#
# Daphne doesn't send ASGI lifespan events, so we simulate them on first
# request to initialize FastMCP's session manager task group.
_mcp_app = None
_mcp_lifespan_task = None
_mcp_ready = asyncio.Event()
_mcp_lock = asyncio.Lock()
_startup_ready = asyncio.Event()
_startup_lock = asyncio.Lock()


async def _mcp_lifespan_runner(app):
    """Simulate ASGI lifespan protocol for FastMCP's Starlette app."""
    startup_sent = False

    async def receive():
        nonlocal startup_sent
        if not startup_sent:
            startup_sent = True
            return {"type": "lifespan.startup"}
        await asyncio.Event().wait()

    async def send(message):
        if message["type"] == "lifespan.startup.complete":
            _mcp_ready.set()

    scope = {"type": "lifespan", "asgi": {"version": "3.0"}}
    try:
        await app(scope, receive, send)
    except Exception:
        log.exception("graphql.mcp_lifespan_failed")


async def _ensure_mcp_ready():
    """Ensure MCP lifespan is running. Recovers from dead task groups."""
    global _mcp_app, _mcp_lifespan_task, _mcp_ready

    if _mcp_lifespan_task is not None and not _mcp_lifespan_task.done():
        return

    async with _mcp_lock:
        if _mcp_lifespan_task is not None and not _mcp_lifespan_task.done():
            return

        if _mcp_lifespan_task is not None:
            log.warning("graphql.mcp_lifespan_recovery", reason="task_died")

        _mcp_app = mcp.http_app(path="/mcp", transport="sse")
        _mcp_ready = asyncio.Event()
        _mcp_lifespan_task = asyncio.create_task(_mcp_lifespan_runner(_mcp_app))

    await _mcp_ready.wait()


async def _ensure_background_services_started():
    """Start backend-owned background loops once per ASGI worker."""
    if _startup_ready.is_set():
        return

    async with _startup_lock:
        if _startup_ready.is_set():
            return
        ensure_reconciler_running()
        _startup_ready.set()


async def http_dispatch(scope, receive, send):
    """Route /mcp and /messages to FastMCP, everything else to Django.

    FastMCP SSE transport serves the SSE stream at /mcp and accepts
    message POSTs at /messages/?session_id=xxx. Both must route to
    the same FastMCP app or MCP clients hang during initialize.
    """
    await _ensure_background_services_started()

    if scope["path"].startswith("/mcp") or scope["path"].startswith("/messages"):
        await _ensure_mcp_ready()
        await _mcp_app(scope, receive, send)
    else:
        await django_asgi_app(scope, receive, send)


# HTTP: /mcp -> FastMCP coordination server, else -> Django ASGI
# WebSocket: Channels for relay + VNC proxy
application = ProtocolTypeRouter(
    {
        "http": http_dispatch,
        "websocket": AuthMiddlewareStack(
            URLRouter(
                [
                    re_path(
                        r"^ws/relay/(?P<agent_id>[0-9a-f-]+)/$",
                        RelayConsumer.as_asgi(),
                    ),
                    re_path(
                        r"^ws/vnc/(?P<agent_id>[0-9a-f-]+)/$",
                        VncProxyConsumer.as_asgi(),
                    ),
                    re_path(
                        r"^ws/dashboard/(?P<project_id>[0-9a-f-]+)/$",
                        DashboardConsumer.as_asgi(),
                    ),
                    re_path(
                        r"^ws/terminal/(?P<agent_id>[0-9a-f-]+)/$",
                        TerminalConsumer.as_asgi(),
                    ),
                ]
            )
        ),
    }
)
