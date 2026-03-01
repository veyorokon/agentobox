"""Relay token authentication -- single implementation for all entry points."""

import structlog

from agents.models import Agent

log = structlog.get_logger("agents.auth_relay")


async def get_relay_agent(token: str) -> Agent:
    """Authenticate by relay_token. Returns Agent or raises ValueError."""
    if not token:
        raise ValueError("Missing relay token")

    try:
        agent = await Agent.objects.aget(relay_token=token)
    except Agent.DoesNotExist:
        raise ValueError("Invalid relay token")

    return agent
