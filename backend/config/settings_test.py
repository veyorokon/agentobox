"""Test settings for unit tests — no external services required.

Imports from the main settings module but overrides:
- SECRET_KEY: hardcoded (no env var needed)
- DATABASES: in-memory SQLite (no Postgres needed)
- CHANNEL_LAYERS: InMemoryChannelLayer (no Redis needed)
- LOGGING: minimal (no structlog/OTEL setup)

Integration tests use the real config.settings (which reads from env/docker).
"""

from pathlib import Path

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

# --- Agent Runtime (stubs — unit tests mock these) ---

AGENT_IMAGE = "agentobox-agent-claude:latest"
ABOX_CALLBACK_URL = "http://backend:8000"
ABOX_DASHBOARD_URL = ""
ANTHROPIC_API_KEY = ""
ABOX_ENCRYPTION_KEY = ""
DOCKER_NETWORK = "agentobox_default"
AGENT_VOLUME_NAME = "agentobox_agent-volumes"
AGENT_ROOTFS_PATH = ""
MODAL_APP_NAME = "agentobox"
MODAL_AGENT_IMAGE = "ghcr.io/veyorokon/agentobox-agent-claude:latest"
VOLUME_ROOT = ""

AGENT_IMAGE_MAP = {
    "claude-code": "agentobox-agent-claude:latest",
}
MODAL_AGENT_IMAGE_MAP = {
    "claude-code": "ghcr.io/veyorokon/agentobox-agent-claude:latest",
}

# --- Media ---

MEDIA_BUCKET = "agentobox-media"
MEDIA_CDN_URL = ""

# --- Session ---

SESSION_COOKIE_NAME = "agentobox_sessionid"

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
