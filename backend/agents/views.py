import json
import os

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from accounts.auth import authenticate_request


@csrf_exempt
@require_POST
async def stream_events(request, agent_id):
    """
    Receive batched stream-json events from the relay process.

    Authenticated via X-Relay-Token header (per-agent token generated
    during provisioning). Returns piggyback response with pending_input
    and pending_signal for relay to deliver to Claude.

    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "/agents/stream Endpoint"
    See: docs/STREAM-JSON-INTEGRATION-SPEC.md, "Piggyback Pattern"
    """
    from agents.models import Agent
    from agents.services.stream import process_stream_events

    # Authenticate via relay token
    token = request.headers.get("X-Relay-Token", "")
    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        return JsonResponse({"error": "agent not found"}, status=404)

    if not agent.relay_token or token != agent.relay_token:
        return JsonResponse({"error": "unauthorized"}, status=401)

    # Parse event batch (may be empty for heartbeat)
    try:
        events = json.loads(request.body) if request.body else []
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "invalid json"}, status=400)

    # Process events
    if events:
        await process_stream_events(agent, events)

    # Update heartbeat timestamp (relay health inference)
    agent.last_heartbeat_at = timezone.now()

    # Build piggyback response
    response = {"ack": True, "pending_input": None, "pending_signal": None}

    if agent.pending_input:
        response["pending_input"] = agent.pending_input
        agent.pending_input = []

    if agent.pending_signal:
        response["pending_signal"] = agent.pending_signal
        agent.pending_signal = ""

    await agent.asave(update_fields=["pending_input", "pending_signal", "last_heartbeat_at"])

    return JsonResponse(response)


@csrf_exempt
@require_POST
async def upload_file(request, agent_id):
    """Copy an uploaded file into an agent's container at /tmp/<filename>."""
    user = await authenticate_request(request)
    if user is None:
        return JsonResponse({"error": "unauthorized"}, status=401)

    from agents.models import Agent
    from agents.runtimes import get_runtime

    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        return JsonResponse({"error": "agent not found"}, status=404)

    if not agent.sandbox_id:
        return JsonResponse({"error": "agent has no running container"}, status=400)

    uploaded = request.FILES.get("file")
    if not uploaded:
        return JsonResponse({"error": "no file provided"}, status=400)

    filename = os.path.basename(uploaded.name)
    dest = f"/tmp/{filename}"
    content = uploaded.read()

    runtime = get_runtime(agent.runtime)
    await runtime.write_file(agent.sandbox_id, content, dest)

    return JsonResponse({"path": dest})
