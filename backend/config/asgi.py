import os

import structlog
from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application
from django.urls import re_path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django_asgi_app = get_asgi_application()

from schema import schema  # noqa: E402
from strawberry.channels.handlers.ws_handler import GraphQLWSConsumer  # noqa: E402

log = structlog.get_logger("agents.websocket")


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


# HTTP: normal Django ASGI (middleware runs, including JWT auth)
# WebSocket: Channels for GraphQL subscriptions
application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
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
