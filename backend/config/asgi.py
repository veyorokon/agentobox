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
from schema import schema  # noqa: E402
from strawberry.channels.handlers.ws_handler import GraphQLWSConsumer  # noqa: E402

log = structlog.get_logger("agents.websocket")

# MCP coordination server — stateless HTTP so each tool call is independent.
# Daphne doesn't send ASGI lifespan events, so we simulate them on first
# request to initialize FastMCP's session manager task group.
mcp_app = mcp.http_app(path="/mcp", stateless_http=True)
_mcp_lifespan_task = None
_mcp_ready = asyncio.Event()


async def _mcp_lifespan_runner():
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
        await mcp_app(scope, receive, send)
    except Exception:
        log.exception("mcp_lifespan_failed")


class LoggingGraphQLWSConsumer(GraphQLWSConsumer):
    """GraphQLWSConsumer with lifecycle logging."""

    async def websocket_connect(self, message):
        log.info(
            "ws_connect",
            path=self.scope.get("path"),
            subprotocols=self.scope.get("subprotocols", []),
        )
        await super().websocket_connect(message)

    async def websocket_disconnect(self, message):
        log.info("ws_disconnect", path=self.scope.get("path"))
        await super().websocket_disconnect(message)

    async def websocket_receive(self, message):
        log.debug("ws_receive", path=self.scope.get("path"))
        await super().websocket_receive(message)


async def http_dispatch(scope, receive, send):
    """Route /mcp to FastMCP, everything else to Django."""
    global _mcp_lifespan_task
    if scope["path"].startswith("/mcp"):
        # Lazy-start MCP lifespan on first request
        if _mcp_lifespan_task is None:
            _mcp_lifespan_task = asyncio.create_task(_mcp_lifespan_runner())
            await _mcp_ready.wait()
        await mcp_app(scope, receive, send)
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
                ]
            )
        ),
    }
)
