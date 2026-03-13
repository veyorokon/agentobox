"""Typed application config — Django-independent.

Reads from environment variables, validates on import, fails loud on
missing required values. Zero Django imports.

Ownership boundary:
  - settings.py owns Django framework config (apps, middleware, DB, etc.)
  - app_config owns product/runtime policy (agent images, callbacks, encryption, etc.)

These two layers MUST NOT own the same values. If a value is in app_config,
it should not also be declared in settings.py (except DASHBOARD_URL which
settings.py reads from app_config for allauth frontend URLs).
"""

from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings


class AgentConfig(BaseSettings):
    runtime: Literal["docker", "modal"] = Field(alias="AGENT_RUNTIME")
    image: str = Field(default="agentobox-agent-claude:latest", alias="AGENT_IMAGE")
    image_map: dict[str, str] = Field(
        default={"claude-code": "agentobox-agent-claude:latest"},
    )
    volume_name: str = Field(default="agentobox_agent-volumes", alias="AGENT_VOLUME_NAME")
    rootfs_path: str = Field(default="", alias="AGENT_ROOTFS_PATH")

    model_config = {"env_prefix": ""}


class ModalConfig(BaseSettings):
    app_name: str = Field(default="agentobox", alias="MODAL_APP_NAME")
    agent_image: str = Field(
        default="ghcr.io/veyorokon/agentobox-agent-claude:latest",
        alias="MODAL_AGENT_IMAGE",
    )
    agent_image_map: dict[str, str] = Field(
        default={"claude-code": "ghcr.io/veyorokon/agentobox-agent-claude:latest"},
    )

    model_config = {"env_prefix": ""}


class ReconcilerConfig(BaseSettings):
    reap_delay_s: int = Field(default=60, alias="AGENT_REAP_DELAY_S")
    keep_failed_containers: bool = Field(default=False, alias="KEEP_FAILED_AGENT_CONTAINERS")

    model_config = {"env_prefix": ""}


class MediaConfig(BaseSettings):
    bucket: str = Field(default="agentobox-media", alias="MEDIA_BUCKET")
    cdn_url: str = Field(default="", alias="MEDIA_CDN_URL")

    model_config = {"env_prefix": ""}


class AppConfig(BaseSettings):
    callback_url: str = Field(default="http://backend:8000", alias="ABOX_CALLBACK_URL")
    dashboard_url: str = Field(default="", alias="ABOX_DASHBOARD_URL")
    encryption_key: str = Field(default="", alias="ABOX_ENCRYPTION_KEY")
    docker_network: str = Field(default="agentobox_default", alias="DOCKER_NETWORK")
    volume_root: str = Field(default="", alias="VOLUME_ROOT")
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    version: str = Field(default="unknown", alias="VERSION")
    environment: str = Field(default="dev", alias="ENVIRONMENT")

    agent: AgentConfig = Field(default_factory=AgentConfig)
    modal: ModalConfig = Field(default_factory=ModalConfig)
    reconciler: ReconcilerConfig = Field(default_factory=ReconcilerConfig)
    media: MediaConfig = Field(default_factory=MediaConfig)

    model_config = {"env_prefix": ""}


app_config = AppConfig()
