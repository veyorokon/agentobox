from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    REDIS_URL=(str, "redis://localhost:6379/0"),
    AGENT_IMAGE=(str, "agentobox-agent-claude:latest"),
    ABOX_CALLBACK_URL=(str, "http://backend:8000"),
    ABOX_DASHBOARD_URL=(str, ""),
    ANTHROPIC_API_KEY=(str, ""),
    ABOX_ENCRYPTION_KEY=(str, ""),
    DOCKER_NETWORK=(str, "agentobox_default"),
    AGENT_VOLUME_NAME=(str, "agentobox_agent-volumes"),
    AGENT_ROOTFS_PATH=(str, ""),
    MODAL_APP_NAME=(str, "agentobox"),
    MODAL_AGENT_IMAGE=(str, "ghcr.io/veyorokon/agentobox-agent-claude:latest"),
    VOLUME_ROOT=(str, ""),
)
environ.Env.read_env(BASE_DIR / ".env", overwrite=False)

SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")

# --- Security (reverse proxy) ---

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True  # Trust X-Forwarded-Host from reverse proxy (Next.js / Caddy)
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

# Build CSRF_TRUSTED_ORIGINS from ALLOWED_HOSTS so Django 4+ POST requests
# work behind a reverse proxy.  Wildcard "*" can't be a trusted origin, so
# we skip it.  In local dev (ALLOWED_HOSTS=["*"]) the list would be empty,
# so we fall back to localhost origins for the dashboard (the browser origin
# for OAuth form POSTs).  In production, set CSRF_TRUSTED_ORIGINS explicitly.
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])
if not CSRF_TRUSTED_ORIGINS:
    _hosts = [f"https://{h}" for h in ALLOWED_HOSTS if h != "*"]
    CSRF_TRUSTED_ORIGINS = _hosts or [
        "http://localhost:5051",
        "http://localhost:3000",
    ]

# --- Apps ---

INSTALLED_APPS = [
    "daphne",
    "corsheaders",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "django_structlog",
    "channels",
    "strawberry_django",
    "config",  # Telemetry and logging setup
    "accounts",
    "projects",
    "agents",
    # django-allauth
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",
    "allauth.socialaccount.providers.github",
    "allauth.headless",
]

# --- Middleware ---

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "accounts.middleware.TokenAuthMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "django_structlog.middlewares.RequestMiddleware",
    "config.middleware.TraceContextMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --- ASGI ---

ASGI_APPLICATION = "config.asgi.application"

# --- Database ---

DATABASES = {
    "default": {
        **env.db("DATABASE_URL", default="sqlite:///db.sqlite3"),
        "CONN_MAX_AGE": 0,  # Close after each request — ASGI/Daphne dispatches ORM
        # calls to threads; CONN_MAX_AGE > 0 keeps each thread's connection alive,
        # causing unbounded idle connection growth under polling load.
        # Real fix: replace polling with project-level WS subscription (task #14).
        "CONN_HEALTH_CHECKS": True,
    }
}

# --- Channels ---

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [env("REDIS_URL")],
            "group_expiry": 86400,
        },
    },
}

# --- Auth ---

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --- django-allauth (headless social auth) ---

HEADLESS_ONLY = True
HEADLESS_TOKEN_STRATEGY = (
    "allauth.headless.tokens.strategies.jwt.JWTTokenStrategy"
)
HEADLESS_JWT_ALGORITHM = "HS256"  # uses SECRET_KEY; no RSA key pair needed

DASHBOARD_URL = env("ABOX_DASHBOARD_URL", default="http://localhost:5051")

HEADLESS_FRONTEND_URLS = {
    "socialaccount_login_cancelled": DASHBOARD_URL + "/auth/callback?error=cancelled",
    "socialaccount_login_error": DASHBOARD_URL + "/auth/callback?error=provider",
}

SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "SCOPE": ["profile", "email"],
        "AUTH_PARAMS": {"access_type": "online"},
        "APP": {
            "client_id": env("GOOGLE_CLIENT_ID", default=""),
            "secret": env("GOOGLE_CLIENT_SECRET", default=""),
        },
    },
    "github": {
        "SCOPE": ["user:email"],
        "APP": {
            "client_id": env("GITHUB_CLIENT_ID", default=""),
            "secret": env("GITHUB_CLIENT_SECRET", default=""),
        },
    },
}

ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*"]
ACCOUNT_EMAIL_VERIFICATION = "none"  # start simple, add verification later
SOCIALACCOUNT_AUTO_SIGNUP = True
SOCIALACCOUNT_EMAIL_AUTHENTICATION = True
SOCIALACCOUNT_EMAIL_AUTHENTICATION_AUTO_CONNECT = True

# --- i18n ---

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# --- Static ---

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Agent Runtime ---

AGENT_IMAGE = env("AGENT_IMAGE")
ABOX_CALLBACK_URL = env("ABOX_CALLBACK_URL")
ABOX_DASHBOARD_URL = env("ABOX_DASHBOARD_URL")
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY")
ABOX_ENCRYPTION_KEY = env("ABOX_ENCRYPTION_KEY")
DOCKER_NETWORK = env("DOCKER_NETWORK")
AGENT_VOLUME_NAME = env("AGENT_VOLUME_NAME")
AGENT_ROOTFS_PATH = env("AGENT_ROOTFS_PATH")
MODAL_APP_NAME = env("MODAL_APP_NAME")
MODAL_AGENT_IMAGE = env("MODAL_AGENT_IMAGE")
VOLUME_ROOT = env("VOLUME_ROOT")

# Per-agent-type image selection. Runtimes look up agent_type in these maps;
# if missing, they fall back to AGENT_IMAGE / MODAL_AGENT_IMAGE.
AGENT_IMAGE_MAP = {
    "claude-code": "agentobox-agent-claude:latest",
}
MODAL_AGENT_IMAGE_MAP = {
    "claude-code": "ghcr.io/veyorokon/agentobox-agent-claude:latest",
}

# --- Media / S3 ---

MEDIA_BUCKET = env("MEDIA_BUCKET", default="agentobox-media")
MEDIA_CDN_URL = env("MEDIA_CDN_URL", default="")

# --- Logging ---

import structlog  # noqa: E402
from config.telemetry import (  # noqa: E402
    RawQueueHandler,
    move_exception_to_stacktrace,
    extract_otel_exception_fields,
    get_log_queue,
    merge_agent_context,
    orjson_renderer,
    truncate_graphql_request,
    truncate_long_values,
)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": structlog.stdlib.ProcessorFormatter,
            "processors": [
                structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                orjson_renderer,  # 2-3x faster than JSONRenderer
            ],
            "foreign_pre_chain": [
                structlog.contextvars.merge_contextvars,
                merge_agent_context,  # Add agent metadata after contextvars
                truncate_graphql_request,  # Shorten URL-encoded GraphQL queries
                truncate_long_values,  # Truncate long string values
                structlog.stdlib.add_log_level,
                structlog.stdlib.add_logger_name,
                structlog.processors.TimeStamper(fmt="iso"),
                structlog.processors.StackInfoRenderer(),
                extract_otel_exception_fields,
                structlog.processors.format_exc_info,
                move_exception_to_stacktrace,
            ],
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
        },
        "queue": {
            "()": RawQueueHandler,
            "queue": get_log_queue(),
        },
    },
    "root": {
        "handlers": ["queue"],
        "level": "INFO",
    },
    # Keep noisy libraries quiet
    "loggers": {
        "django": {"level": "INFO"},
        "django.server": {"level": "WARNING"},
        "channels": {"level": "WARNING"},
        # Channels server logs full URL-encoded GraphQL queries at INFO — very noisy
        "django.channels.server": {"level": "WARNING"},
        # Daphne HTTP logs - suppress in favor of Django middleware structured logs
        "daphne.server": {"level": "ERROR"},
        "daphne.http_protocol": {"level": "ERROR"},
        # Strawberry default error logging — suppressed in favor of
        # GraphQLLoggingExtension which logs with classification + context
        "strawberry.execution": {"level": "CRITICAL"},
    },
}

# --- Session ---

SESSION_COOKIE_NAME = "agentobox_sessionid"

# --- CORS ---

CORS_ALLOW_ALL_ORIGINS = env.bool("CORS_ALLOW_ALL", default=False)
CORS_ALLOWED_ORIGINS = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=["http://localhost:3000", "http://localhost:5051"],
)
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    "accept",
    "authorization",
    "content-type",
    "origin",
    "traceparent",
    "x-csrftoken",
    "x-requested-with",
    "x-session-token",
]

# --- Observability ---

from config.telemetry import setup as setup_telemetry  # noqa: E402

setup_telemetry()
