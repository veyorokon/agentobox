from agents.models import Agent


async def create_agent(
    project_id: str,
    name: str,
    goal_text: str,
    context_path: str,
    runtime_name: str = "modal",
) -> Agent:
    ...


async def kill_agent(project_id: str, name: str) -> bool:
    ...


async def process_agent_event(payload: dict) -> None:
    ...
