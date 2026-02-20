import hmac
import json
import os

from asgiref.sync import sync_to_async
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from accounts.auth import authenticate_request

ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB


@sync_to_async(thread_sensitive=False)
def _atomic_drain_piggyback(agent_id):
    """Drain pending_input and pending_signal under a row lock.

    Uses select_for_update() inside transaction.atomic() to prevent
    concurrent _atomic_enqueue from committing between read and clear,
    which would silently lose enqueued messages.

    Returns (pending_input, pending_signal).
    """
    from agents.models import Agent

    with transaction.atomic():
        agent = Agent.objects.select_for_update().get(id=agent_id)

        pending_input = agent.pending_input or []
        pending_signal = agent.pending_signal or ""

        agent.pending_input = []
        agent.pending_signal = ""
        agent.last_heartbeat_at = timezone.now()
        agent.save(update_fields=["pending_input", "pending_signal", "last_heartbeat_at"])

    return pending_input, pending_signal


@csrf_exempt
@require_POST
async def stream_events(request, agent_id):
    """
    Receive batched stream-json events from the relay process.

    Authenticated via X-Relay-Token header (per-agent token generated
    during provisioning). Returns piggyback response with pending_input
    and pending_signal for relay to deliver to Claude.

    See: docs/ARCHITECTURE.md, "/agents/stream Endpoint"
    See: docs/ARCHITECTURE.md, "Piggyback Pattern"
    """
    from agents.models import Agent
    from agents.services.reconcile import ensure_running
    from agents.services.stream import process_stream_events

    ensure_running()

    # Authenticate via relay token
    token = request.headers.get("X-Relay-Token", "")
    try:
        agent = await Agent.objects.aget(id=agent_id)
    except Agent.DoesNotExist:
        return JsonResponse({"error": "agent not found"}, status=404)

    if not agent.relay_token or not hmac.compare_digest(token, agent.relay_token):
        return JsonResponse({"error": "unauthorized"}, status=401)

    # Parse event batch (may be empty for heartbeat)
    try:
        events = json.loads(request.body) if request.body else []
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "invalid json"}, status=400)

    # Process events
    if events:
        await process_stream_events(agent, events)

    # Atomically drain pending_input and pending_signal under row lock.
    # This prevents _atomic_enqueue from committing a message between
    # our read and clear, which would silently lose that message.
    pending_input, pending_signal = await _atomic_drain_piggyback(agent_id)

    # Build piggyback response
    response = {"ack": True, "pending_input": None, "pending_signal": None}

    if pending_input:
        response["pending_input"] = pending_input

    if pending_signal:
        response["pending_signal"] = pending_signal

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
        agent = await Agent.objects.select_related("project").aget(id=agent_id)
    except Agent.DoesNotExist:
        return JsonResponse({"error": "agent not found"}, status=404)

    if agent.project.owner_id != user.pk:
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


@csrf_exempt
@require_POST
async def upload_media(request):
    """Upload an image to S3 and return its public URL."""
    user = await authenticate_request(request)
    if user is None:
        return JsonResponse({"error": "unauthorized"}, status=401)

    uploaded = request.FILES.get("file")
    if not uploaded:
        return JsonResponse({"error": "no file provided"}, status=400)
    if uploaded.content_type not in ALLOWED_IMAGE_TYPES:
        return JsonResponse({"error": "unsupported file type"}, status=400)
    if uploaded.size > MAX_UPLOAD_SIZE:
        return JsonResponse({"error": "file too large"}, status=400)

    from agents.services.media import upload_raw

    data = uploaded.read()
    url = await sync_to_async(upload_raw)(data, uploaded.content_type, "uploads")
    return JsonResponse({"url": url})
