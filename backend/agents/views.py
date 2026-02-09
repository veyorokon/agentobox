import json
import os

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from accounts.auth import authenticate_request


@csrf_exempt
@require_POST
async def hook_event(request):
    """Receive hook events from agent containers."""
    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "invalid json"}, status=400)

    from agents.services.lifecycle import process_hook_event

    await process_hook_event(payload)

    return JsonResponse({"ok": True})


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
