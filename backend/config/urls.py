from django.contrib import admin
from django.urls import path
from django.views.decorators.csrf import csrf_exempt
from strawberry.django.views import AsyncGraphQLView

from agents.views import upload_file, upload_media
from config.health import health
from schema import schema

urlpatterns = [
    path("health", health),
    path("admin/", admin.site.urls),
    path("graphql", csrf_exempt(AsyncGraphQLView.as_view(schema=schema))),
    path("media/upload", upload_media, name="media-upload"),
    path("agents/<uuid:agent_id>/upload", upload_file, name="agent-upload"),
]
