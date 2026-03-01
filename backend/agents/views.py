"""
REST endpoints: file uploads and the hook bridge for CC native team tools.

Two concerns live here:

1. File uploads — upload_file (push a file into an agent container) and
   upload_media (upload an image to S3, return public URL). Both require
   Bearer auth and validate ownership.

2. Hook bridge — POST endpoint that CC PreToolUse/PostToolUse hooks call
   with {tool_name, tool_input}. Auth is Bearer relay_token → Agent lookup.
   Read-only tools (TaskList, TaskGet) run as PreToolUse (before CC executes
   the native tool). Mutating tools (SendMessage, TaskCreate, TaskUpdate) run
   as PostToolUse (after CC's native tool, so the hook result arrives as a
   systemMessage). Handlers are lazy-loaded to avoid circular imports.

CC uses camelCase param names; _cc_to_snake() normalizes to Python convention.
Handler dispatch filters params to only those the handler signature accepts,
so adding new CC fields won't break existing handlers.
"""
import inspect
import json
import os

import structlog
from asgiref.sync import sync_to_async
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from fastmcp.exceptions import ToolError

from accounts.auth import authenticate_request

log = structlog.get_logger("agents.views")

ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB


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


# ---------------------------------------------------------------------------
# Hook bridge — CC native team tools routed through backend
# ---------------------------------------------------------------------------

# CC camelCase param names → Python snake_case
_PARAM_MAP = {
    "taskId": "task_id",
    "activeForm": "active_form",
    "addBlocks": "add_blocks",
    "addBlockedBy": "add_blocked_by",
}


def _cc_to_snake(params: dict) -> dict:
    return {_PARAM_MAP.get(k, k): v for k, v in params.items()}


def _allowed_params(fn):
    """Extract keyword parameter names from a function signature."""
    sig = inspect.signature(fn)
    return {
        name for name, p in sig.parameters.items()
        if name != "self" and p.kind in (
            inspect.Parameter.KEYWORD_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        )
    } - {"agent"}  # agent is passed positionally


# Read-only tools run before the native tool (no side effects to undo).
# Mutating tools run after to let CC's native tool execute first — the hook
# bridge result arrives via systemMessage either way.
_PRE_HANDLERS = {}   # tool_name → do_* function (PreToolUse)
_POST_HANDLERS = {}  # tool_name → do_* function (PostToolUse)


def _load_handlers():
    """Lazy-load to avoid circular imports at module scope."""
    if _PRE_HANDLERS or _POST_HANDLERS:
        return
    from agents.services.mcp_coord import (
        create_task,
        deliver_message,
        get_task,
        list_tasks,
        update_task,
    )
    _PRE_HANDLERS.update({
        "TaskList": list_tasks,
        "TaskGet": get_task,
    })
    _POST_HANDLERS.update({
        "SendMessage": deliver_message,
        "TaskCreate": create_task,
        "TaskUpdate": update_task,
    })


@csrf_exempt
@require_POST
async def hook_bridge(request):
    """REST endpoint for agent hook bridge calls.

    CC PreToolUse/PostToolUse hooks POST here with {tool_name, tool_input}.
    Auth is Bearer relay_token → Agent lookup.
    """
    _load_handlers()

    token = request.headers.get("Authorization", "").removeprefix("Bearer ")
    from agents.services.auth_relay import get_relay_agent

    try:
        agent = await get_relay_agent(token)
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=401)

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "invalid JSON body"}, status=400)

    tool_name = body.get("tool_name", "")
    tool_input = body.get("tool_input", {})
    params = _cc_to_snake(tool_input)

    handler = _PRE_HANDLERS.get(tool_name) or _POST_HANDLERS.get(tool_name)
    if not handler:
        return JsonResponse({"error": f"unknown tool: {tool_name}"}, status=400)

    try:
        allowed = _allowed_params(handler)
        filtered = {k: v for k, v in params.items() if k in allowed}
        result = await handler(agent, **filtered)
        return JsonResponse({"ok": True, "result": result})
    except ToolError as e:
        return JsonResponse({"error": str(e)}, status=400)
    except Exception:  # intentional: catch-all for hook bridge — log and return 500 so agent gets error response
        log.exception("hook_bridge_error", tool=tool_name, agent=agent.name)
        return JsonResponse({"error": "internal error"}, status=500)
