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
from agents.consumers import RelayConsumer, VncProxyConsumer  # noqa: E402
from schema import schema  # noqa: E402
from strawberry.channels.handlers.ws_handler import GraphQLWSConsumer  # noqa: E402

log = structlog.get_logger("abox.graphql")

# MCP coordination server — stateless HTTP so each tool call is independent.
# Daphne doesn't send ASGI lifespan events, so we simulate them on first
# request to initialize FastMCP's session manager task group.
#
# StreamableHTTPSessionManager.run() can only be called once per instance.
# If the lifespan task dies (exception, cancellation), we must create a fresh
# mcp_app to get a new session manager. _ensure_mcp_ready() handles recovery.
_mcp_app = None
_mcp_lifespan_task = None
_mcp_ready = asyncio.Event()
_mcp_lock = asyncio.Lock()


async def _mcp_lifespan_runner(app):
    """Simulate ASGI lifespan protocol for FastMCP's Starlette app.

    Sends lifespan.startup, waits for startup.complete, then blocks
    indefinitely to keep the session manager's task group alive.
    """
    startup_sent = False

    async def receive():
        nonlocal startup_sent
        if not startup_sent:
            startup_sent = True
            return {"type": "lifespan.startup"}
        # Block forever — shutdown happens when the server exits
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
    """Ensure MCP lifespan is running. Recovers from dead task groups.

    StreamableHTTPSessionManager.run() can only be called once per instance,
    so if the lifespan task dies we must create a fresh mcp_app.
    """
    global _mcp_app, _mcp_lifespan_task, _mcp_ready

    # Fast path — already running
    if _mcp_lifespan_task is not None and not _mcp_lifespan_task.done():
        return

    async with _mcp_lock:
        # Re-check under lock
        if _mcp_lifespan_task is not None and not _mcp_lifespan_task.done():
            return

        if _mcp_lifespan_task is not None:
            log.warning("graphql.mcp_lifespan_recovery", reason="task_died")

        _mcp_app = mcp.http_app(path="/mcp", stateless_http=True)
        _mcp_ready = asyncio.Event()
        _mcp_lifespan_task = asyncio.create_task(_mcp_lifespan_runner(_mcp_app))

    await _mcp_ready.wait()


class LoggingGraphQLWSConsumer(GraphQLWSConsumer):
    """GraphQLWSConsumer with lifecycle logging."""

    async def websocket_connect(self, message):
        log.info(
            "graphql.ws_connected",
            path=self.scope.get("path"),
            subprotocols=self.scope.get("subprotocols", []),
        )
        await super().websocket_connect(message)

    async def websocket_disconnect(self, message):
        log.info("graphql.ws_disconnected", path=self.scope.get("path"))
        await super().websocket_disconnect(message)

    async def websocket_receive(self, message):
        log.debug("graphql.ws_received", path=self.scope.get("path"))
        await super().websocket_receive(message)


async def http_dispatch(scope, receive, send):
    """Route /mcp to FastMCP, everything else to Django."""
    if scope["path"].startswith("/mcp"):
        await _ensure_mcp_ready()
        await _mcp_app(scope, receive, send)
    else:
        await django_asgi_app(scope, receive, send)


# HTTP: /mcp -> FastMCP coordination server, else -> Django ASGI
# WebSocket: Channels for GraphQL subscriptions
application = ProtocolTypeRouter(
    {
        "http": http_dispatch,
        "websocket": AuthMiddlewareStack(
            URLRouter(
                [
                    re_path(
                        r"^graphql$",
                        LoggingGraphQLWSConsumer.as_asgi(schema=schema),
                    ),
                    # Relay WebSocket — bidirectional channel for stream events
                    # and commands (replaces HTTP POST + piggyback pattern)
                    re_path(
                        r"^ws/relay/(?P<agent_id>[0-9a-f-]+)/$",
                        RelayConsumer.as_asgi(),
                    ),
                    # VNC proxy — binary WebSocket relay to agent's websockify
                    re_path(
                        r"^ws/vnc/(?P<agent_id>[0-9a-f-]+)/$",
                        VncProxyConsumer.as_asgi(),
                    ),
                ]
            )
        ),
    }
)
