"""Test settings for unit tests — no external services required.

Imports from the main settings module but overrides:
- SECRET_KEY: hardcoded (no env var needed)
- DATABASES: in-memory SQLite (no Postgres needed)
- CHANNEL_LAYERS: InMemoryChannelLayer (no Redis needed)
- LOGGING: minimal (no structlog/OTEL setup)

Integration tests use the real config.settings (which reads from env/docker).
"""

import os
from pathlib import Path

# Set env vars before any module imports app_config (pydantic validates on import).
os.environ.setdefault("SECRET_KEY", "test-only-not-for-production")
os.environ.setdefault("AGENT_RUNTIME", "docker")

BASE_DIR = Path(__file__).resolve().parent.parent

# --- Core ---

SECRET_KEY = "test-only-not-for-production"
DEBUG = True
ALLOWED_HOSTS = ["*"]

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
    "channels",
    "strawberry_django",
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
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "allauth.account.middleware.AccountMiddleware",
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

# --- Database (in-memory SQLite for unit tests) ---

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

# --- Channels (in-memory, no Redis) ---

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    },
}

# --- Auth ---

AUTH_USER_MODEL = "accounts.User"
AUTH_PASSWORD_VALIDATORS = []

# --- i18n ---

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# --- Static ---

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- App Config ---
# Policy/runtime config lives in config.app_config (pydantic-settings).
# Env vars set at top of file before any imports.
# See conftest.py for monkeypatching app_config in tests that need
# non-default values.

# --- Session ---

SESSION_COOKIE_NAME = "agentobox_sessionid"

# --- django-allauth (headless social auth) ---

HEADLESS_ONLY = True
HEADLESS_TOKEN_STRATEGY = (
    "allauth.headless.tokens.strategies.jwt.JWTTokenStrategy"
)
HEADLESS_JWT_ALGORITHM = "HS256"

HEADLESS_FRONTEND_URLS = {
    "socialaccount_login_cancelled": "http://localhost:5051/auth/callback?error=cancelled",
    "socialaccount_login_error": "http://localhost:5051/auth/callback?error=provider",
}

SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "SCOPE": ["profile", "email"],
        "AUTH_PARAMS": {"access_type": "online"},
        "APP": {
            "client_id": "test-google-client-id",
            "secret": "test-google-client-secret",
        },
    },
    "github": {
        "SCOPE": ["user:email"],
        "APP": {
            "client_id": "test-github-client-id",
            "secret": "test-github-client-secret",
        },
    },
}

ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*"]
ACCOUNT_EMAIL_VERIFICATION = "none"
SOCIALACCOUNT_AUTO_SIGNUP = True
SOCIALACCOUNT_EMAIL_AUTHENTICATION = True
SOCIALACCOUNT_EMAIL_AUTHENTICATION_AUTO_CONNECT = True

# --- CORS ---

CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOWED_ORIGINS = []

# --- Logging (minimal — no structlog/OTEL setup) ---

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "WARNING",
    },
}
