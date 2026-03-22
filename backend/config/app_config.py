"""Typed application config — single source of truth for all env vars.

Reads from environment variables and .env file. Validates on import,
fails loud on missing required values. Zero Django imports.

This replaces django-environ. ALL environment variable reads go through
pydantic-settings here. settings.py reads from app_config, never from
os.environ directly. CI validates secrets by importing this module —
if it imports, all required vars exist with valid types.
"""

from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class _EnvSettings(BaseSettings):
    """Base for all config classes — reads .env file + os.environ."""

    model_config = SettingsConfigDict(
        env_prefix="",
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )


# ── Django framework config ──────────────────────────────────────────


class DjangoConfig(_EnvSettings):
    secret_key: str = Field(alias="SECRET_KEY")
    debug: bool = Field(default=False, alias="DEBUG")
    allowed_hosts: str = Field(default="localhost,127.0.0.1", alias="ALLOWED_HOSTS")
    database_url: str = Field(default="sqlite:///db.sqlite3", alias="DATABASE_URL")
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    csrf_trusted_origins: str = Field(default="", alias="CSRF_TRUSTED_ORIGINS")
    cors_allow_all: bool = Field(default=False, alias="CORS_ALLOW_ALL")
    cors_allowed_origins: str = Field(
        default="http://localhost:3000,http://localhost:5051",
        alias="CORS_ALLOWED_ORIGINS",
    )

    def parse_allowed_hosts(self) -> list[str]:
        return [h.strip() for h in self.allowed_hosts.split(",") if h.strip()]

    def parse_csrf_trusted_origins(self) -> list[str]:
        if not self.csrf_trusted_origins:
            return []
        return [o.strip() for o in self.csrf_trusted_origins.split(",") if o.strip()]

    def parse_cors_allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]

    def parse_database(self) -> dict:
        """Parse DATABASE_URL into Django DATABASES dict format."""
        url = self.database_url
        if url.startswith("sqlite"):
            return {
                "ENGINE": "django.db.backends.sqlite3",
                "NAME": url.split("///", 1)[1] if "///" in url else ":memory:",
            }
        parsed = urlparse(url)
        return {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": parsed.path.lstrip("/"),
            "USER": parsed.username or "",
            "PASSWORD": parsed.password or "",
            "HOST": parsed.hostname or "",
            "PORT": str(parsed.port) if parsed.port else "",
        }


class OAuthConfig(_EnvSettings):
    google_client_id: str = Field(default="", alias="GOOGLE_CLIENT_ID")
    google_client_secret: str = Field(default="", alias="GOOGLE_CLIENT_SECRET")
    github_client_id: str = Field(default="", alias="GITHUB_CLIENT_ID")
    github_client_secret: str = Field(default="", alias="GITHUB_CLIENT_SECRET")


# ── Product / runtime policy ─────────────────────────────────────────


class AgentConfig(_EnvSettings):
    runtime: Literal["docker", "modal"] = Field(default="modal", alias="AGENT_RUNTIME")
    image: str = Field(default="agentobox-agent-runtime-desktop-managed:latest", alias="AGENT_IMAGE")
    executor_override: str = Field(default="", alias="AGENT_EXECUTOR_OVERRIDE")
    image_map: dict[str, str] = Field(
        default_factory=dict,
    )
    volume_name: str = Field(default="agentobox_agent-volumes", alias="AGENT_VOLUME_NAME")


class ModalConfig(_EnvSettings):
    app_name: str = Field(default="agentobox", alias="MODAL_APP_NAME")
    agent_image: str = Field(
        default="ghcr.io/veyorokon/agentobox-agent-runtime-desktop-managed:dev",
        alias="MODAL_AGENT_IMAGE",
    )
    agent_image_map: dict[str, str] = Field(
        default_factory=dict,
    )


class ReconcilerConfig(_EnvSettings):
    reap_delay_s: int = Field(default=60, alias="AGENT_REAP_DELAY_S")
    keep_failed_containers: bool = Field(default=False, alias="KEEP_FAILED_AGENT_CONTAINERS")


class MediaConfig(_EnvSettings):
    bucket: str = Field(default="agentobox-media", alias="MEDIA_BUCKET")
    cdn_url: str = Field(default="", alias="MEDIA_CDN_URL")


# ── Root config ──────────────────────────────────────────────────────


class AppConfig(_EnvSettings):
    callback_url: str = Field(default="http://backend:8000", alias="ABOX_CALLBACK_URL")
    dashboard_url: str = Field(default="", alias="ABOX_DASHBOARD_URL")
    encryption_key: str = Field(default="", alias="ABOX_ENCRYPTION_KEY")
    docker_network: str = Field(default="agentobox_default", alias="DOCKER_NETWORK")
    volume_root: str = Field(default="", alias="VOLUME_ROOT")
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    version: str = Field(default="unknown", alias="VERSION")
    environment: str = Field(default="dev", alias="ENVIRONMENT")
    smoke_test_user: str = Field(default="demo", alias="SMOKE_TEST_USER")
    test_agent_model: str = Field(default="", alias="ABOX_TEST_AGENT_MODEL")

    django: DjangoConfig = Field(default_factory=DjangoConfig)
    oauth: OAuthConfig = Field(default_factory=OAuthConfig)
    agent: AgentConfig = Field(default_factory=AgentConfig)
    modal: ModalConfig = Field(default_factory=ModalConfig)
    reconciler: ReconcilerConfig = Field(default_factory=ReconcilerConfig)
    media: MediaConfig = Field(default_factory=MediaConfig)


app_config = AppConfig()
