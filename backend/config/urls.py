from django.contrib import admin
from django.urls import include, path
from strawberry.django.views import AsyncGraphQLView

from schema import schema

urlpatterns = [
    path("admin/", admin.site.urls),
    path("graphql", AsyncGraphQLView.as_view(schema=schema)),
    path("webhook/", include("webhooks.urls")),
]
