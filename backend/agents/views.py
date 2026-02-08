import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST


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
