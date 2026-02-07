from django.db import connection
from django.http import JsonResponse


async def health(request):
    """Lightweight health check. Verifies DB connectivity."""
    try:
        await connection.aensure_connection()
        return JsonResponse({"status": "ok"})
    except Exception as exc:
        return JsonResponse(
            {"status": "error", "detail": str(exc)},
            status=503,
        )
