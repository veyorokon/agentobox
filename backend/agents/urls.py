from django.urls import path

from agents.views import hook_event

urlpatterns = [
    path("event", hook_event, name="hook-event"),
]
