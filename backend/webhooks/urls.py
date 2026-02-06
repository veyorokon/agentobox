from django.urls import path

from webhooks.views import agent_event

urlpatterns = [
    path("event", agent_event, name="agent-event"),
]
