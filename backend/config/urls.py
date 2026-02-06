from django.contrib import admin
from django.urls import include, path
from django.views.decorators.csrf import csrf_exempt
from strawberry.django.views import AsyncGraphQLView

from schema import schema

urlpatterns = [
    path("admin/", admin.site.urls),
    path("graphql", csrf_exempt(AsyncGraphQLView.as_view(schema=schema))),
    path("webhook/", include("webhooks.urls")),
]
