from django.db import connection
from django.http import JsonResponse


def health(request):
    """Lightweight health check. Verifies DB connectivity."""
    try:
        connection.ensure_connection()
        return JsonResponse({"status": "ok"})
    except Exception as exc:
        return JsonResponse(
            {"status": "error", "detail": str(exc)},
            status=503,
        )
