from config.app_config import app_config

_django = app_config.django
_oauth = app_config.oauth

# --- Core ---

SECRET_KEY = _django.secret_key
DEBUG = _django.debug
ALLOWED_HOSTS = _django.parse_allowed_hosts()

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
CSRF_TRUSTED_ORIGINS = _django.parse_csrf_trusted_origins()
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
        **_django.parse_database(),
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
            "hosts": [_django.redis_url],
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

DASHBOARD_URL = app_config.dashboard_url or "http://localhost:5051"

HEADLESS_FRONTEND_URLS = {
    "socialaccount_login_cancelled": DASHBOARD_URL + "/auth/callback?error=cancelled",
    "socialaccount_login_error": DASHBOARD_URL + "/auth/callback?error=provider",
}

SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "SCOPE": ["profile", "email"],
        "AUTH_PARAMS": {"access_type": "online"},
        "APP": {
            "client_id": _oauth.google_client_id,
            "secret": _oauth.google_client_secret,
        },
    },
    "github": {
        "SCOPE": ["user:email"],
        "APP": {
            "client_id": _oauth.github_client_id,
            "secret": _oauth.github_client_secret,
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

from pathlib import Path  # noqa: E402

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


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

CORS_ALLOW_ALL_ORIGINS = _django.cors_allow_all
CORS_ALLOWED_ORIGINS = _django.parse_cors_allowed_origins()
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
