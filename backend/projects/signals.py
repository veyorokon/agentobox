import asyncio

import structlog
from asgiref.sync import async_to_sync
from django.db.models.signals import post_save
from django.dispatch import receiver

from projects.models import Project

log = structlog.get_logger("projects.signals")


@receiver(post_save, sender=Project)
def auto_deploy_team_lead(sender, instance, created, **kwargs):
    """
    Auto-deploy a team lead agent when a new project is created.

    Uses the "solo" template from TEAM_CONFIGS with opus-4-6 model.
    Runs synchronously via async_to_sync to work in Django signal context.
    """
    if not created:
        return

    project = instance
    op_log = log.bind(project_id=str(project.id), project_name=project.name)
    op_log.info("auto_deploying_team_lead")

    try:
        from agents.services.lifecycle import create_agent
        from agents.services.provision import TEAM_CONFIGS

        template = TEAM_CONFIGS["solo"]
        lead_config = template["agents"][0]

        # Create team lead agent with template config
        async_to_sync(_create_team_lead)(
            project_id=str(project.id),
            config=lead_config,
            op_log=op_log,
        )

    except Exception:
        op_log.exception("auto_deploy_team_lead_failed")


async def _create_team_lead(project_id: str, config: dict, op_log):
    """Async helper to create the team lead agent."""
    from agents.services.lifecycle import create_agent
    from agents.services.provision import resolve_mcp_servers

    # Resolve MCP server names to full config
    mcp_config = None
    if config.get("mcp_servers"):
        mcp_config = resolve_mcp_servers(config["mcp_servers"])

    agent = await create_agent(
        project_id=project_id,
        name=config["name"],
        runtime_name="docker",  # Default to docker for local dev
        model=config["model"],
        mcp_servers=mcp_config,
        workspace_path="",
        instructions=config["instructions"],
        secret_group_ids=None,
        role=config["role"],
    )

    op_log.info(
        "team_lead_auto_deployed",
        agent_id=str(agent.id),
        agent_name=agent.name,
        model=agent.model,
    )
