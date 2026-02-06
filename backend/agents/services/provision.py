from agents.models import Goal
from agents.runtimes.base import Runtime
from projects.models import Project


async def provision_workspace(
    runtime: Runtime,
    sandbox_id: str,
    project: Project,
    goal: Goal,
) -> None:
    ...
