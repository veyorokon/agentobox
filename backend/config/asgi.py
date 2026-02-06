import os

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application
from django.urls import re_path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django_asgi_app = get_asgi_application()

from schema import schema  # noqa: E402
from strawberry.channels.handlers.ws_handler import GraphQLWSConsumer  # noqa: E402

# HTTP: normal Django ASGI (middleware runs, including JWT auth)
# WebSocket: Channels for GraphQL subscriptions
application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AuthMiddlewareStack(
            URLRouter(
                [
                    re_path(r"^graphql$", GraphQLWSConsumer.as_asgi(schema=schema)),
                ]
            )
        ),
    }
)
