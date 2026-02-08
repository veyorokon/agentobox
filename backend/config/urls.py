from django.contrib import admin
from django.urls import include, path
from django.views.decorators.csrf import csrf_exempt
from strawberry.django.views import AsyncGraphQLView

from config.health import health
from schema import schema

urlpatterns = [
    path("health", health),
    path("admin/", admin.site.urls),
    path("graphql", csrf_exempt(AsyncGraphQLView.as_view(schema=schema))),
    path("hooks/", include("agents.urls")),
]
