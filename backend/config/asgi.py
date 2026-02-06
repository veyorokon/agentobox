import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django_asgi_app = get_asgi_application()

from strawberry_django.routers import AuthGraphQLProtocolTypeRouter  # noqa: E402

from schema import schema  # noqa: E402

application = AuthGraphQLProtocolTypeRouter(
    schema,
    django_application=django_asgi_app,
)
