import hashlib
import hmac
import json

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST


def verify_hmac(body: bytes, signature: str | None) -> bool:
    if not signature:
        return False
    secret = getattr(settings, "WEBHOOK_SECRET", "")
    expected = hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


@csrf_exempt
@require_POST
async def agent_event(request):
    signature = request.headers.get("X-Signature")
    if not verify_hmac(request.body, signature):
        return JsonResponse({"error": "invalid signature"}, status=401)

    payload = json.loads(request.body)

    from agents.services.lifecycle import process_agent_event

    await process_agent_event(payload)

    # Check for pending inbound messages to deliver back to the agent
    response = {"ok": True}
    agent_name = payload.get("agent_name", "")
    project_id = payload.get("project_id", "")

    if agent_name and project_id:
        from agents.models import Agent
        from agents.services.comms import get_pending_messages

        try:
            agent = await Agent.objects.aget(
                project_id=project_id, name=agent_name
            )
            messages = await get_pending_messages(agent)
            if messages:
                response["message"] = " | ".join(messages)
        except Agent.DoesNotExist:
            pass

    return JsonResponse(response)
