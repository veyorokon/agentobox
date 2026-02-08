from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    REDIS_URL=(str, "redis://localhost:6379/0"),
    AGENT_IMAGE=(str, "agentobox-agent:latest"),
    ABOX_CALLBACK_URL=(str, "http://backend:8000"),
    ANTHROPIC_API_KEY=(str, ""),
    DOCKER_NETWORK=(str, "agentobox_default"),
    MODAL_APP_NAME=(str, "agentobox"),
    MODAL_AGENT_IMAGE=(str, "ghcr.io/veyorokon/agentobox-agent:latest"),
)
environ.Env.read_env(BASE_DIR / ".env", overwrite=False)

SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")

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
    "accounts",
    "projects",
    "agents",
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

DATABASES = {"default": env.db("DATABASE_URL", default="sqlite:///db.sqlite3")}

# --- Channels ---

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [env("REDIS_URL")],
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

# --- i18n ---

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# --- Static ---

STATIC_URL = "static/"

# --- Agent Runtime ---

AGENT_IMAGE = env("AGENT_IMAGE")
ABOX_CALLBACK_URL = env("ABOX_CALLBACK_URL")
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY")
DOCKER_NETWORK = env("DOCKER_NETWORK")
MODAL_APP_NAME = env("MODAL_APP_NAME")
MODAL_AGENT_IMAGE = env("MODAL_AGENT_IMAGE")

# --- Logging ---

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
        "level": "INFO",
    },
    # Keep noisy libraries quiet
    "loggers": {
        "django": {"level": "INFO"},
        "django.server": {"level": "WARNING"},
        "channels": {"level": "WARNING"},
    },
}

# --- Session ---

SESSION_COOKIE_NAME = "agentobox_sessionid"

# --- CORS ---

CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
]
CORS_ALLOW_HEADERS = [
    "accept",
    "authorization",
    "content-type",
    "origin",
    "traceparent",
    "x-csrftoken",
    "x-requested-with",
]

# --- Observability ---

from config.telemetry import setup as setup_telemetry  # noqa: E402

setup_telemetry()
