import asyncio

from django.core.management.base import BaseCommand

from agents.services.reconcile import recover_lifecycle_attempts


class Command(BaseCommand):
    help = "Finalize dangling running lifecycle attempts based on current agent state."

    def handle(self, *args, **options):
        asyncio.run(recover_lifecycle_attempts())
        self.stdout.write("Lifecycle attempt recovery complete.")
