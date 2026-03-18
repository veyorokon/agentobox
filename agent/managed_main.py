"""Managed-mode process entrypoint.

This wraps the normal runtime entrypoint with an explicit managed bootstrap
wait so the image can block on canonical provisioning readiness in code rather
than recreating old shell-based startup races.
"""

from __future__ import annotations

import os

from agent.main import ApplicationFactory, run_forever
from agent.runtime.app import AgentApplication
from agent.runtime.bootstrap import ManagedBootstrap
from agent.runtime.config import RuntimeConfig
from agent.runtime.envfiles import apply_env_overrides, load_managed_runtime_env
from agent.runtime.logging import configure_logging_context


def main(app_factory: ApplicationFactory = AgentApplication) -> None:
    bootstrap_config = RuntimeConfig.from_env()
    configure_logging_context(
        mode=bootstrap_config.mode.value,
        platform=bootstrap_config.platform.value,
        profile=bootstrap_config.profile.value,
        agent_id=bootstrap_config.managed.agent_id if bootstrap_config.managed else "",
        image_ref=bootstrap_config.build.image_ref,
        git_commit=bootstrap_config.build.git_commit,
        root_dir=bootstrap_config.root_dir,
    )
    timeout_s = float(os.environ.get("AGENTOBOX_PROVISIONING_TIMEOUT_S", "120"))
    poll_interval_s = float(os.environ.get("AGENTOBOX_PROVISIONING_POLL_INTERVAL_S", "0.25"))
    ManagedBootstrap(bootstrap_config).wait_until_ready(
        timeout_s=timeout_s,
        poll_interval_s=poll_interval_s,
    )
    apply_env_overrides(load_managed_runtime_env(bootstrap_config.root_dir), override=True)
    config = RuntimeConfig.from_env()
    configure_logging_context(
        mode=config.mode.value,
        platform=config.platform.value,
        profile=config.profile.value,
        agent_id=config.managed.agent_id if config.managed else "",
        image_ref=config.build.image_ref,
        git_commit=config.build.git_commit,
        root_dir=config.root_dir,
    )
    run_forever(app_factory(config))
