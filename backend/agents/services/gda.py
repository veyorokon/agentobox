import asyncio

import structlog

from agents.models import Agent

log = structlog.get_logger("agents.gda")


async def gda_loop() -> None:
    log.info("gda_loop_running")
    while True:
        await asyncio.sleep(5)


async def evaluate_agent(agent: Agent) -> None:
    ...
