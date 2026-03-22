import atexit
import logging.handlers
import os
import queue
import re
import tomllib
from pathlib import Path

import orjson
import structlog
from contextvars import ContextVar

# Context variable for agent metadata
_agent_context: ContextVar[dict | None] = ContextVar("agent_context", default=None)

# Queue for async logging performance
_log_queue = queue.Queue(-1)  # Unlimited size
_queue_listener = None


def _get_version():
    """Get version from environment or pyproject.toml."""
    from config.app_config import app_config
    if app_config.version != "unknown":
        return app_config.version

    # Fallback: read from pyproject.toml
    try:
        pyproject_path = Path(__file__).parent.parent / "pyproject.toml"
        with open(pyproject_path, "rb") as f:
            data = tomllib.load(f)
            return data.get("project", {}).get("version", "unknown")
    except Exception:
        return "unknown"


_VERSION = _get_version()


def add_service_metadata(logger, method_name, event_dict):
    """Add service metadata to every log entry (OTel semantic convention keys)."""
    event_dict["service.name"] = "agentobox-backend"
    event_dict["service.version"] = _VERSION
    from config.app_config import app_config
    event_dict["environment"] = app_config.environment
    return event_dict


# Fields injected by django_structlog that add noise without debugging value.
# ip: proxy/CDN IP, not the real client. user_agent: never useful for debugging.
_DROP_FIELDS = {"ip", "user_agent"}


def drop_noisy_fields(logger, method_name, event_dict):
    """Remove fields that consume log space without aiding debugging."""
    for key in _DROP_FIELDS:
        event_dict.pop(key, None)
    return event_dict


def extract_otel_exception_fields(logger, method_name, event_dict):
    """
    Extract exception into OpenTelemetry semantic convention fields.

    Converts exc_info into flat structured fields:
    - exception.type: Fully qualified exception class name
    - exception.message: Exception message string
    - exception.stacktrace: Full traceback as string (filled by format_exc_info)

    Runs BEFORE format_exc_info to extract type/message from exc_info.
    Handles both exc_info=True (from BoundLogger.exception()) and exc_info=(type, val, tb).
    """
    exc_info = event_dict.get("exc_info")

    # BoundLogger.exception() sets exc_info=True. Resolve to actual tuple
    # so we can extract type/message before format_exc_info consumes it.
    if exc_info is True:
        import sys
        exc_info = sys.exc_info()
        if exc_info[0] is not None:
            event_dict["exc_info"] = exc_info  # Replace True with tuple for format_exc_info

    if exc_info and isinstance(exc_info, tuple) and len(exc_info) == 3:
        exc_type, exc_value, exc_tb = exc_info
        if exc_type is not None:
            event_dict["exception.type"] = f"{exc_type.__module__}.{exc_type.__name__}"
            event_dict["exception.message"] = str(exc_value)

    return event_dict


def move_exception_to_stacktrace(logger, method_name, event_dict):
    """
    Move formatted exception string to exception.stacktrace field.

    Runs AFTER format_exc_info to complete the OTel exception fields.
    Removes the redundant "exception" key — exception.type/message/stacktrace
    are the only exception fields in the output.
    """
    exception_str = event_dict.pop("exception", None)
    if exception_str and isinstance(exception_str, str):
        # Only add stacktrace if we already have type/message (from extract_otel_exception_fields)
        if "exception.type" in event_dict and "exception.message" in event_dict:
            event_dict["exception.stacktrace"] = exception_str

    return event_dict


MAX_VALUE_LENGTH = 200


def truncate_long_values(logger, method_name, event_dict):
    """Truncate string values longer than MAX_VALUE_LENGTH in log output.

    For values over MAX_VALUE_LENGTH, logs a preview of first 100 + last 50
    chars with truncated=True and full_length metadata. This replaces blind
    truncation with enough context to know what was lost.

    Skips 'event' (the event name) and 'exception' / 'exception.stacktrace'
    (handled by structlog's exception formatting).
    """
    skip_keys = {"event", "exception", "exception.stacktrace", "exception.type", "exception.message"}
    truncated_keys = []
    for key, value in event_dict.items():
        if key in skip_keys:
            continue
        if isinstance(value, str) and len(value) > MAX_VALUE_LENGTH:
            full_length = len(value)
            preview = value[:100] + " ... " + value[-50:]
            event_dict[key] = preview
            truncated_keys.append((key, full_length))
    if truncated_keys:
        event_dict["truncated"] = True
        for key, full_length in truncated_keys:
            event_dict[f"{key}.full_length"] = full_length
    return event_dict


def truncate_graphql_request(logger, method_name, event_dict):
    """Truncate URL-encoded GraphQL query strings in request log fields.

    django_structlog logs the full request path including query params.
    GraphQL GET requests encode the entire query in the URL, producing
    multi-KB log lines that are unreadable and wasteful.
    """
    request = event_dict.get("request")
    if isinstance(request, str) and "/graphql?" in request and len(request) > 120:
        # Keep method + path + operation name hint, drop the query noise
        method_path = request.split("?", 1)[0]
        # Try to extract operationName from the query string
        op_match = re.search(r"operationName=([^&]+)", request)
        op_name = op_match.group(1) if op_match else "unknown"
        event_dict["request"] = f"{method_path} [{op_name}]"
    return event_dict


def merge_agent_context(logger, method_name, event_dict):
    """
    Merge agent metadata from context variable into log entries.

    Adds agent_id, agent_name, agent_sandbox_id, agent_project_id as flat
    root-level keys when available.
    """
    agent_ctx = _agent_context.get()
    if agent_ctx:
        if agent_ctx.get("id"):
            event_dict["agent_id"] = agent_ctx["id"]
        if agent_ctx.get("name"):
            event_dict["agent_name"] = agent_ctx["name"]
        if agent_ctx.get("sandbox_id"):
            event_dict["agent_sandbox_id"] = agent_ctx["sandbox_id"]
        if agent_ctx.get("project_id"):
            event_dict["agent_project_id"] = agent_ctx["project_id"]

    return event_dict


def normalize_domain_field_names(logger, method_name, event_dict):
    """Normalize legacy field aliases into one canonical log vocabulary."""
    from_status = event_dict.pop("from_status", None)
    to_status = event_dict.pop("to_status", None)
    if from_status is not None and "previous_status" not in event_dict:
        event_dict["previous_status"] = from_status
    if to_status is not None and "next_status" not in event_dict:
        event_dict["next_status"] = to_status
    return event_dict


def bind_agent_context(agent_id: str, agent_name: str, sandbox_id: str = "", project_id: str = ""):
    """
    Bind agent metadata to current execution context.

    All logs in this context will include agent metadata automatically.
    Call clear_agent_context() when the operation completes.
    """
    _agent_context.set({
        "id": agent_id,
        "name": agent_name,
        "sandbox_id": sandbox_id,
        "project_id": project_id,
    })


def clear_agent_context():
    """Clear agent metadata from current execution context."""
    _agent_context.set(None)


def orjson_renderer(_, __, event_dict):
    """
    Render event_dict as JSON using orjson (2-3x faster than stdlib json).

    orjson.dumps returns bytes, which we decode to str for logging output.
    """
    return orjson.dumps(event_dict).decode("utf-8")


# ANSI color codes for pretty dev formatter
_LEVEL_COLORS = {
    "debug": "\033[2m",       # dim
    "info": "\033[36m",       # cyan
    "warning": "\033[33m",    # yellow
    "error": "\033[31m",      # red
    "critical": "\033[1;31m", # bold red
}
_RESET = "\033[0m"
_DIM = "\033[2m"
_BOLD = "\033[1m"


def pretty_renderer(_, __, event_dict):
    """Human-readable colored log output for local dev.

    Gated on LOG_FORMAT=pretty. Shows level, event, and key fields
    on a single line with ANSI colors. Exceptions render below.
    """
    level = event_dict.pop("level", "info")
    event = event_dict.pop("event", "")
    timestamp = event_dict.pop("timestamp", "")

    # Remove noise fields for dev output
    for k in ("service.name", "service.version", "environment", "logger"):
        event_dict.pop(k, None)

    color = _LEVEL_COLORS.get(level, "")
    level_str = f"{color}{level.upper():>8}{_RESET}"

    # Format timestamp to just time portion
    time_str = ""
    if timestamp:
        t = timestamp.split("T")[-1].split(".")[0] if "T" in timestamp else timestamp
        time_str = f"{_DIM}{t}{_RESET} "

    # Build context string from remaining fields
    exc_stacktrace = event_dict.pop("exception.stacktrace", None)
    exc_type = event_dict.pop("exception.type", None)
    exc_message = event_dict.pop("exception.message", None)

    ctx_parts = []
    for k, v in event_dict.items():
        if isinstance(v, str) and len(v) > 80:
            v = v[:80] + "..."
        ctx_parts.append(f"{_DIM}{k}={_RESET}{v}")
    ctx_str = f" {' '.join(ctx_parts)}" if ctx_parts else ""

    line = f"{time_str}{level_str} {_BOLD}{event}{_RESET}{ctx_str}"

    # Append exception below if present
    if exc_type and exc_message:
        line += f"\n  {color}{exc_type}: {exc_message}{_RESET}"
    if exc_stacktrace:
        # Show last few frames, indented
        frames = exc_stacktrace.strip().split("\n")
        # Keep header + last 6 lines (3 frames)
        if len(frames) > 7:
            frames = [frames[0], "  ..."] + frames[-6:]
        for frame in frames:
            line += f"\n  {_DIM}{frame}{_RESET}"

    return line


def get_log_queue():
    """Get the log queue for QueueHandler setup."""
    return _log_queue


class RawQueueHandler(logging.handlers.QueueHandler):
    """QueueHandler that skips formatting to preserve structlog's dict-based record.msg.

    The default QueueHandler.prepare() calls self.format(record), which converts
    record.msg to a string via the default formatter. This breaks ProcessorFormatter
    downstream in the QueueListener, which expects record.msg to be a dict
    (as set by structlog's wrap_for_formatter). By returning the record unmodified,
    the QueueListener's handler can apply ProcessorFormatter to the raw record.
    """

    def prepare(self, record):
        return record


def start_queue_listener():
    """
    Start background thread to process log queue.

    Call this in AppConfig.ready() to start async logging.

    The QueueHandler queues LogRecords with wrapped event_dicts (from wrap_for_formatter).
    The console handler in the QueueListener applies ProcessorFormatter to render as JSON.
    """
    global _queue_listener
    import logging

    if _queue_listener is not None:
        return  # Already started

    # Create console handler with ProcessorFormatter
    console_handler = logging.StreamHandler()

    # LOG_FORMAT=pretty for colored dev output, default JSON for production
    renderer = pretty_renderer if os.getenv("LOG_FORMAT") == "pretty" else orjson_renderer

    # Apply ProcessorFormatter to render queued event_dicts.
    # structlog logs arrive pre-processed (via wrap_for_formatter).
    # Foreign (stdlib) logs need the pre_chain to add structlog fields.
    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            drop_noisy_fields,  # Final pass: strip ip/user_agent from django_structlog context
            normalize_domain_field_names,
            # Extract exc_info from LogRecord into event_dict.
            # BoundLogger.exception() sets exc_info on the LogRecord, not
            # the structlog event_dict. The configure() chain's format_exc_info
            # never sees it. This processor runs after wrap_for_formatter
            # unwraps, so it can pull exc_info from the record.
            extract_otel_exception_fields,
            structlog.processors.format_exc_info,
            move_exception_to_stacktrace,
            renderer,
        ],
        foreign_pre_chain=[
            drop_noisy_fields,
            structlog.contextvars.merge_contextvars,
            merge_agent_context,
            normalize_domain_field_names,
            truncate_graphql_request,
            truncate_long_values,
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            extract_otel_exception_fields,
            structlog.processors.format_exc_info,
            move_exception_to_stacktrace,
        ],
    )
    console_handler.setFormatter(formatter)

    # Create listener with console handler
    _queue_listener = logging.handlers.QueueListener(
        _log_queue,
        console_handler,
        respect_handler_level=True,
    )
    _queue_listener.start()

    # Ensure cleanup on exit
    atexit.register(stop_queue_listener)


def stop_queue_listener():
    """Stop the queue listener (called on shutdown)."""
    global _queue_listener
    if _queue_listener is not None:
        _queue_listener.stop()
        _queue_listener = None


def _classify_graphql_error(error):
    """Classify a GraphQL error for structured logging.

    Returns ``(error_code, is_client_error, original_exception | None)``.

    Client errors are expected conditions (bad input, not found, forbidden)
    — logged at ``warning``, no stack trace.  Server errors are bugs that
    need developer attention — logged at ``error`` with full traceback.
    """
    original = getattr(error, "original_error", None)
    if original is None:
        # Pure GraphQL error (syntax, validation) — client's fault
        return "VALIDATION", True, None

    exc_name = type(original).__name__
    if "DoesNotExist" in exc_name:
        return "NOT_FOUND", True, original
    if exc_name == "PermissionDenied":
        return "FORBIDDEN", True, original
    if exc_name == "ValidationError":
        return "VALIDATION", True, original

    return "INTERNAL", False, original


class GraphQLLoggingExtension:
    """
    Strawberry schema extension that logs every GraphQL operation.

    Emits one structured log per operation with timing, user, variables,
    and — when errors occur — classified error details.

    Client errors (not-found, forbidden, validation) log at ``warning``
    without a stack trace.  Server errors log at ``error`` with a full
    traceback via structlog's ``exc_info`` processing.

    Strawberry's default ``process_errors`` logging is suppressed in
    ``_Schema`` so this extension is the single source of truth.

    Logger: ``graphql.query`` or ``graphql.mutation``.
    Event:  ``graphql.{type}.{OperationName}`` (first root field for
    anonymous operations).
    """

    def on_operation(self):
        import time

        start = time.monotonic()
        yield
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)

        ctx = self.execution_context
        op_type, op_name = _extract_operation_info(ctx)
        log = structlog.get_logger(f"graphql.{op_type}")
        event_name = f"graphql.{op_type}.{op_name}"

        log_kwargs = {"duration_ms": elapsed_ms}

        # Bind user_id from request context when available
        request = getattr(ctx.context, "request", None)
        if request:
            user = getattr(request, "user", None)
            if user and getattr(user, "is_authenticated", False):
                log_kwargs["user_id"] = user.id

        # Include variables but redact sensitive values
        if ctx.variables:
            log_kwargs["variables"] = _redact_variables(ctx.variables)

        result = ctx.result
        errors = result.errors if result and hasattr(result, "errors") and result.errors else None

        if not errors:
            log.info(event_name, **log_kwargs)
            return

        for error in errors:
            code, is_client, original = _classify_graphql_error(error)

            kw = {
                **log_kwargs,
                "error.code": code,
                "error.is_client_error": is_client,
                "error.message": str(original) if original else getattr(error, "message", str(error)),
            }
            if original:
                kw["error.type"] = f"{type(original).__module__}.{type(original).__name__}"

            if is_client:
                log.warning(event_name, **kw)
            elif original and getattr(original, "__traceback__", None):
                log.error(event_name, exc_info=(type(original), original, original.__traceback__), **kw)
            else:
                log.error(event_name, **kw)

    def resolve(self, _next, root, info, *args, **kwargs):
        return _next(root, info, *args, **kwargs)


def _extract_operation_info(ctx) -> tuple[str, str]:
    """Derive (operation_type, operation_name) from an ExecutionContext.

    Returns the explicit operation name when provided by the client.
    For anonymous operations, falls back to the first root-level field
    name from the parsed document (e.g. ``agents``, ``createAgent``).
    Only if neither is available does it fall back to parsing the raw
    query string.
    """
    # --- operation type ---
    # Prefer the parsed document (accurate), fall back to raw string prefix.
    op_type = "query"
    try:
        op_type = ctx.operation_type.value  # "query" | "mutation" | "subscription"
    except (RuntimeError, AttributeError):
        # graphql_document not yet populated (e.g. parse error) — sniff raw query.
        if ctx.query:
            stripped = ctx.query.strip()
            if stripped.startswith("mutation"):
                op_type = "mutation"
            elif stripped.startswith("subscription"):
                op_type = "subscription"

    # --- operation name ---
    # 1. Explicit name from the client ("query GetAgents { ... }")
    op_name = ctx.operation_name
    if op_name:
        return op_type, op_name

    # 2. First root-level field from the parsed AST
    doc = ctx.graphql_document
    if doc and doc.definitions:
        defn = doc.definitions[0]
        selections = getattr(defn, "selection_set", None)
        if selections and selections.selections:
            first_field = selections.selections[0]
            field_name = getattr(first_field, "name", None)
            if field_name:
                return op_type, field_name.value

    # 3. Last resort — regex the first field name out of the raw query.
    #    Handles "{ agents ... }" and "mutation { createAgent ... }".
    if ctx.query:
        m = re.search(r"{\s*(\w+)", ctx.query)
        if m:
            return op_type, m.group(1)

    return op_type, "unknown"


def _redact_variables(variables: dict) -> dict:
    """Shallow-redact sensitive variable values."""
    redacted = {}
    for key, val in variables.items():
        if any(s in key.lower() for s in ("password", "secret", "token", "api_key", "apikey", "authorization", "encrypted")):
            redacted[key] = "***"
        elif isinstance(val, dict):
            redacted[key] = _redact_variables(val)
        else:
            redacted[key] = val
    return redacted


def setup():
    """
    Configure structlog to integrate with Python's stdlib logging.

    The processor chain ends with ProcessorFormatter.wrap_for_formatter,
    which allows the Django LOGGING config's ProcessorFormatter to handle
    the final JSON rendering. This prevents double-nesting.
    """
    structlog.configure(
        processors=[
            add_service_metadata,
            drop_noisy_fields,  # Strip ip/user_agent injected by django_structlog
            structlog.contextvars.merge_contextvars,
            merge_agent_context,  # Add agent metadata from context
            normalize_domain_field_names,
            truncate_graphql_request,  # Shorten URL-encoded GraphQL queries
            truncate_long_values,  # Truncate long string values
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            extract_otel_exception_fields,  # Extract type/message from exc_info
            structlog.processors.format_exc_info,  # Format exc_info to exception string
            move_exception_to_stacktrace,  # Copy exception string to exception.stacktrace
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
