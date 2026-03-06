"""
Mechanical trigger loop -- evaluates cron triggers and wakes agents.

Local dev: `manage.py run_triggers` (runs once by default)
           `manage.py run_triggers --loop` (continuous, 60s between checks)
Production: Modal cron calls the same evaluate_triggers() function.

Only evaluates agents with status=idle and cron triggers. Sends a message
with source="trigger" metadata so the feed can filter it out.
"""

import asyncio

import structlog
from croniter import croniter
from django.core.management.base import BaseCommand
from django.utils import timezone

from agents.models import Agent, AgentStatus

log = structlog.get_logger("abox.triggers")


async def evaluate_triggers():
    """Evaluate all cron triggers across idle agents with non-empty trigger configs.

    For each cron trigger, checks if the trigger should have fired since its
    last_triggered_at timestamp. If so, sends the trigger's message to the
    agent and updates last_triggered_at in the JSONField.

    Returns the number of triggers that fired.
    """
    from agents.services.comms import send_message

    now = timezone.now()
    fired_count = 0

    # Only idle agents with at least one trigger configured
    agents = [
        a async for a in Agent.objects.filter(
            status=AgentStatus.IDLE,
        ).exclude(triggers=[])
    ]

    for agent in agents:
        triggers = agent.triggers
        if not isinstance(triggers, list):
            continue

        triggers_modified = False

        for i, trigger in enumerate(triggers):
            if not isinstance(trigger, dict):
                continue

            trigger_type = trigger.get("type")
            if trigger_type != "cron":
                continue

            schedule = trigger.get("schedule")
            if not schedule:
                log.warning(
                    "triggers.missing_schedule",
                    agent_name=agent.name,
                    trigger_index=i,
                )
                continue

            # Validate cron expression
            try:
                croniter(schedule)
            except (ValueError, KeyError):
                log.warning(
                    "triggers.invalid_cron",
                    agent_name=agent.name,
                    schedule=schedule,
                )
                continue

            message = trigger.get("message", "Trigger fired")

            # Determine if this trigger should fire: check if a cron tick
            # occurred between last_triggered_at and now.
            last_triggered = trigger.get("last_triggered_at")
            if last_triggered:
                try:
                    last_dt = timezone.datetime.fromisoformat(last_triggered)
                    if timezone.is_naive(last_dt):
                        last_dt = timezone.make_aware(last_dt)
                except (ValueError, TypeError):
                    last_dt = now - timezone.timedelta(minutes=2)
            else:
                # First evaluation: set baseline to 2 minutes ago so the
                # trigger fires on the first matching tick, not immediately.
                last_dt = now - timezone.timedelta(minutes=2)

            # croniter.get_next() from last_triggered_at -- if the next tick
            # is <= now, the trigger should fire.
            cron = croniter(schedule, last_dt)
            next_fire_dt = cron.get_next(timezone.datetime)
            if timezone.is_naive(next_fire_dt):
                next_fire_dt = timezone.make_aware(next_fire_dt)

            if next_fire_dt <= now:
                log.info(
                    "triggers.firing",
                    agent_name=agent.name,
                    schedule=schedule,
                    message=message[:100],
                )

                sent = await send_message(
                    str(agent.id), message, source="trigger",
                )

                if sent:
                    fired_count += 1
                    # Update last_triggered_at in-place on the trigger object
                    triggers[i]["last_triggered_at"] = now.isoformat()
                    triggers_modified = True
                else:
                    log.warning(
                        "triggers.send_failed",
                        agent_name=agent.name,
                    )

        # Persist updated last_triggered_at timestamps
        if triggers_modified:
            agent.triggers = triggers
            await agent.asave(update_fields=["triggers"])

    return fired_count


class Command(BaseCommand):
    help = "Evaluate cron triggers and wake idle agents."

    def add_arguments(self, parser):
        parser.add_argument(
            "--loop",
            action="store_true",
            help="Run continuously with 60-second intervals.",
        )

    def handle(self, *args, **options):
        loop_mode = options["loop"]

        if loop_mode:
            self.stdout.write("Starting trigger loop (60s interval)...")
            asyncio.run(self._run_loop())
        else:
            fired = asyncio.run(evaluate_triggers())
            self.stdout.write(f"Evaluated triggers: {fired} fired.")

    async def _run_loop(self):
        while True:
            try:
                fired = await evaluate_triggers()
                if fired:
                    log.info("triggers.loop_pass", fired=fired)
            except Exception:  # intentional: trigger loop must never crash -- log and retry next interval
                log.exception("triggers.loop_error")

            await asyncio.sleep(60)
