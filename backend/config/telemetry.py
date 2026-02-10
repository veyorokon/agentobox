import atexit
import logging.handlers
import os
import queue
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
    # 1. Try environment variable first (for Docker/k8s)
    if version := os.getenv("VERSION"):
        return version

    # 2. Try reading from pyproject.toml
    try:
        pyproject_path = Path(__file__).parent.parent / "pyproject.toml"
        with open(pyproject_path, "rb") as f:
            data = tomllib.load(f)
            return data.get("project", {}).get("version", "unknown")
    except Exception:
        return "unknown"


def add_service_metadata(logger, method_name, event_dict):
    """Add service metadata to every log entry."""
    event_dict["service"] = {
        "name": "agentobox-backend",
        "version": _get_version(),  # Dynamic
    }
    event_dict["deployment"] = {
        "environment": os.getenv("ENVIRONMENT", "dev"),
    }
    return event_dict


def extract_otel_exception_fields(logger, method_name, event_dict):
    """
    Extract exception into OpenTelemetry semantic convention fields.

    Converts exc_info tuple into flat structured fields:
    - exception.type: Fully qualified exception class name
    - exception.message: Exception message string
    - exception.stacktrace: Full traceback as string (filled by format_exc_info)

    Runs BEFORE format_exc_info to extract type/message from exc_info tuple.
    The "exception" field is preserved for format_exc_info to populate with stacktrace.
    """
    exc_info = event_dict.get("exc_info")
    if exc_info and isinstance(exc_info, tuple) and len(exc_info) == 3:
        exc_type, exc_value, exc_tb = exc_info
        if exc_type is not None:
            # Use flat OTel field names
            event_dict["exception.type"] = f"{exc_type.__module__}.{exc_type.__name__}"
            event_dict["exception.message"] = str(exc_value)
            # exception.stacktrace will be added after format_exc_info runs

    return event_dict


def copy_exception_to_stacktrace(logger, method_name, event_dict):
    """
    Copy formatted exception string to exception.stacktrace field.

    Runs AFTER format_exc_info to complete the OTel exception fields.
    Keeps the "exception" field for backward compatibility.
    """
    exception_str = event_dict.get("exception")
    if exception_str and isinstance(exception_str, str):
        # Only add stacktrace if we already have type/message (from extract_otel_exception_fields)
        if "exception.type" in event_dict and "exception.message" in event_dict:
            event_dict["exception.stacktrace"] = exception_str

    return event_dict


def merge_agent_context(logger, method_name, event_dict):
    """
    Merge agent metadata from context variable into log entries.

    Adds agent.id, agent.name, agent.sandbox_id, agent.project_id when available.
    """
    agent_ctx = _agent_context.get()
    if agent_ctx:
        event_dict["agent"] = agent_ctx

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


def get_log_queue():
    """Get the log queue for QueueHandler setup."""
    return _log_queue


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

    # Apply ProcessorFormatter to render queued event_dicts as JSON
    # No foreign_pre_chain needed - structlog logs are already processed
    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.JSONRenderer(),
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
            structlog.contextvars.merge_contextvars,
            merge_agent_context,  # Add agent metadata from context
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            extract_otel_exception_fields,  # Extract type/message from exc_info
            structlog.processors.format_exc_info,  # Format exc_info to exception string
            copy_exception_to_stacktrace,  # Copy exception string to exception.stacktrace
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
