from agents.models import Case


async def find_similar_cases(
    goal_text: str, context_path: str, limit: int = 3
) -> list[Case]:
    ...


async def format_guidance(cases: list[Case]) -> str:
    ...
