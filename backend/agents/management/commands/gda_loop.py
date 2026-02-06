import asyncio

import structlog
from django.core.management.base import BaseCommand

log = structlog.get_logger("agents.gda")


class Command(BaseCommand):
    help = "Run the GDA (Goal-Driven Autonomy) loop"

    def handle(self, *args, **options):
        self.stdout.write("GDA loop started, polling...")
        asyncio.run(self._run())

    async def _run(self):
        from agents.services.gda import gda_loop

        await gda_loop()
