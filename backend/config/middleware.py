import structlog


class TraceContextMiddleware:
    """Extract W3C traceparent from request headers, bind to structlog contextvars.

    When OTEL is enabled, DjangoInstrumentor already creates child spans from
    the incoming traceparent — inject_trace_context reads from those. This
    middleware is a no-op in that case since OTEL sets the contextvars first.

    When OTEL is disabled (dev), this ensures trace_id/span_id still appear
    in every log line by parsing the header directly.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    async def __call__(self, request):
        traceparent = request.headers.get("traceparent", "")
        parts = traceparent.split("-")
        if len(parts) == 4:
            structlog.contextvars.bind_contextvars(
                trace_id=parts[1],
                span_id=parts[2],
            )
        response = await self.get_response(request)
        return response
