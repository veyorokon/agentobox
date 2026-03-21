import json

from django.core.management.base import BaseCommand

from agents.services.limbo import list_limbo_candidates


class Command(BaseCommand):
    help = "List agents currently matching a known limbo signature."

    def add_arguments(self, parser):
        parser.add_argument("--grace-seconds", type=int, default=120)
        parser.add_argument("--json", action="store_true", dest="as_json")

    def handle(self, *args, **options):
        candidates = list_limbo_candidates(grace_seconds=options["grace_seconds"])
        if options["as_json"]:
            self.stdout.write(
                json.dumps([candidate.asdict() for candidate in candidates], indent=2)
            )
            return

        if not candidates:
            self.stdout.write("No limbo agents found.")
            return

        for candidate in candidates:
            self.stdout.write(
                " | ".join(
                    [
                        f"agent={candidate.agent_name}",
                        f"agent_id={candidate.agent_id}",
                        f"project_id={candidate.project_id}",
                        f"signature={candidate.signature}",
                        f"age_s={candidate.age_seconds}",
                        f"status={candidate.lifecycle_status}",
                        f"preview={candidate.preview_state or '-'}",
                        f"relay_connected={candidate.relay_connected}",
                        f"is_converged={candidate.is_converged}",
                        f"runtime={candidate.preview_runtime_id or '-'}",
                    ]
                )
            )
