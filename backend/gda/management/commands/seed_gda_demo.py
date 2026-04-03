from __future__ import annotations

from datetime import datetime, timezone

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from agents.models import Agent, AgentStatus
from agents.services.lifecycle import create_agent, hard_restart_agent
from gda.models import (
    ProjectCommitment,
    ProjectCommitmentAssignment,
    ProjectExecution,
    ProjectObservation,
    ProjectState,
    ProjectStateEntry,
)
from gda.services.assignment import assign_project_commitment
from gda.services.commitments import authorize_commitment, persist_commitment_proposal
from gda.services.compile import compile_run_spec_for_project
from gda.services.state import persist_run_spec_state
from gda_kernel import CommitmentProposal, State, StateVersion, project_ref, world_ref
from projects.models import Project

User = get_user_model()
FILE_SUBJECT_REF = "file:///workspace/hello.txt"


def _ensure_agent(
    *,
    project: Project,
    name: str,
    role: str,
) -> Agent:
    agent, _created = Agent.objects.update_or_create(
        project=project,
        name=name,
        defaults={
            "runtime": "docker",
            "status": AgentStatus.STOPPED,
            "desired_status": "stopped",
            "role": role,
            "agent_type": "claude-code",
            "workspace_path": "/workspace/agentobox",
            "session_id": f"session:{name}",
            "model": "claude-sonnet-4-6",
            "mode": "plan" if role == "lead" else "auto",
            "attention_level": "none",
            "task": "",
            "instructions": "",
        },
    )
    return agent


class Command(BaseCommand):
    help = "Seed one reproducible GDA demo project with lead/worker agents and an assigned commitment."

    def add_arguments(self, parser):
        parser.add_argument("--username", default="demo")
        parser.add_argument("--password", default="demo")
        parser.add_argument("--project-name", default="gda-demo")
        parser.add_argument(
            "--scenario",
            choices=("runtime", "file"),
            default="runtime",
            help="Seed the runtime-readiness demo or the file-creation demo.",
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete existing GDA demo records for the target project before reseeding.",
        )
        parser.add_argument(
            "--no-deploy",
            action="store_true",
            help="Seed demo data only and skip provisioning runnable agent containers.",
        )

    def handle(self, *args, **options):
        username = options["username"]
        password = options["password"]
        project_name = options["project_name"]
        scenario = options["scenario"]
        reset = bool(options["reset"])
        no_deploy = bool(options["no_deploy"])

        user, _created = User.objects.get_or_create(
            username=username,
            defaults={"email": f"{username}@agentobox.dev"},
        )
        user.set_password(password)
        user.save()

        project, _created = Project.objects.get_or_create(
            name=project_name,
            owner=user,
            defaults={"description": "Reproducible GDA dogfood demo project"},
        )

        if reset:
            ProjectCommitmentAssignment.objects.filter(project=project).delete()
            ProjectExecution.objects.filter(project=project).delete()
            ProjectObservation.objects.filter(project=project).delete()
            ProjectCommitment.objects.filter(project=project).delete()
            ProjectStateEntry.objects.filter(project=project).delete()
            ProjectState.objects.filter(project=project).delete()
            Agent.objects.filter(project=project, name__in=("meta-agent", "worker-agent")).delete()

        if no_deploy:
            lead = _ensure_agent(project=project, name="meta-agent", role="lead")
            worker = _ensure_agent(project=project, name="worker-agent", role="worker")
        else:
            existing = {
                agent.name: agent
                for agent in Agent.objects.filter(project=project, name__in=("meta-agent", "worker-agent"))
            }
            if "meta-agent" in existing:
                lead = async_to_sync(hard_restart_agent)(str(existing["meta-agent"].id), background=False)
            else:
                lead = async_to_sync(create_agent)(
                    project_id=str(project.id),
                    name="meta-agent",
                    runtime_name="docker",
                    model="claude-sonnet-4-6",
                    mcp_servers=None,
                    workspace_path="",
                    instructions="",
                    role="lead",
                    mode="plan",
                    agent_type="claude-code",
                    background=False,
                )
            if "worker-agent" in existing:
                worker = async_to_sync(hard_restart_agent)(str(existing["worker-agent"].id), background=False)
            else:
                worker = async_to_sync(create_agent)(
                    project_id=str(project.id),
                    name="worker-agent",
                    runtime_name="docker",
                    model="claude-sonnet-4-6",
                    mcp_servers=None,
                    workspace_path="",
                    instructions="",
                    role="worker",
                    mode="auto",
                    agent_type="claude-code",
                    background=False,
                )

        now = datetime(2026, 4, 2, 12, 0, tzinfo=timezone.utc)
        if scenario == "file":
            title = "Create hello file"
            goals = (
                {
                    "goal_id": "goal-1",
                    "name": "hello file exists",
                    "target_conditions": (
                        {
                            "dimension_id": "workspace.file.exists",
                            "subject_ref": FILE_SUBJECT_REF,
                            "operator": "eq",
                            "expected_value": {"exists": True},
                        },
                    ),
                },
                {
                    "goal_id": "goal-2",
                    "name": "hello file content matches",
                    "target_conditions": (
                        {
                            "dimension_id": "workspace.file.content",
                            "subject_ref": FILE_SUBJECT_REF,
                            "operator": "eq",
                            "expected_value": {"content": "hello from agentobox"},
                        },
                    ),
                },
            )
            allowed_capabilities = ("workspace.write_file",)
            commitment_id = "commitment-file-1"
            capability_id = "workspace.write_file"
            touched_scope = (FILE_SUBJECT_REF,)
            expected_observation = {
                "kind": "workspace.file.changed",
                "required": True,
                "subject": FILE_SUBJECT_REF,
            }
            expected_outcome = {"status": "ok", "required": True}
            assignment_dimension_ids = ("workspace.file.exists", "workspace.file.content")
            assignment_observation_kinds = ("workspace.file.changed",)
        else:
            title = "Restore runtime readiness"
            goals = (
                {
                    "goal_id": "goal-1",
                    "name": "runtime is ready",
                    "target_conditions": (
                        {
                            "dimension_id": "runtime.health",
                            "operator": "eq",
                            "expected_value": {"status": "ready"},
                        },
                    ),
                },
            )
            allowed_capabilities = ("ops.check_runtime_health",)
            commitment_id = "commitment-runtime-1"
            capability_id = "ops.check_runtime_health"
            touched_scope = (project_ref(project.id),)
            expected_observation = {"kind": "runtime.health.changed", "required": True}
            expected_outcome = {"status": "ok", "required": True}
            assignment_dimension_ids = ("runtime.health",)
            assignment_observation_kinds = ("runtime.health.changed",)

        run_spec = compile_run_spec_for_project(
            project=project,
            task_bundle={
                "title": title,
                "goals": goals,
                "allowed_capabilities": allowed_capabilities,
            },
            now=now,
            world_ref=world_ref(project.id),
        )
        persist_run_spec_state(
            project=project,
            run_spec=run_spec,
            state=State(
                subject=project_ref(project.id),
                version=StateVersion(version_id="v1", observed_at=now, source_refs=("seed://gda-demo",)),
                facts={},
            ),
            status="running",
        )

        proposal = CommitmentProposal(
            capability_id=capability_id,
            arguments=(
                {"path": "/workspace/hello.txt", "content": "hello from agentobox"}
                if scenario == "file"
                else {"check": "runtime.health"}
            ),
            touched_scope=touched_scope,
            expected_observation=expected_observation,
            expected_outcome=expected_outcome,
        )
        persist_commitment_proposal(
            project=project,
            proposal=proposal,
            commitment_id=commitment_id,
            status="proposed",
            opened_at=now,
        )
        authorize_commitment(
            project=project,
            commitment_id=commitment_id,
            activated_at=now,
        )
        assign_project_commitment(
            project=project,
            commitment_id=commitment_id,
            agent=worker,
            dimension_ids=assignment_dimension_ids,
            observation_kinds=assignment_observation_kinds,
        )

        self.stdout.write(self.style.SUCCESS("Seeded GDA demo project"))
        self.stdout.write(f"user={username}")
        self.stdout.write(f"project={project.name} ({project.id})")
        self.stdout.write(f"lead={lead.name} ({lead.id})")
        self.stdout.write(f"worker={worker.name} ({worker.id})")
        self.stdout.write(f"scenario={scenario}")
        self.stdout.write(f"objective={title}")
        if scenario == "file":
            self.stdout.write("goal=workspace.file.exists == {'exists': true}")
            self.stdout.write("goal=workspace.file.content == {'content': 'hello from agentobox'}")
            self.stdout.write("commitment=commitment-file-1")
            self.stdout.write("worker assignment=workspace.file.exists workspace.file.content / workspace.file.changed")
        else:
            self.stdout.write("goal=runtime.health == {'status': 'ready'}")
            self.stdout.write("commitment=commitment-runtime-1")
            self.stdout.write("worker assignment=runtime.health / runtime.health.changed")
        self.stdout.write("")
        self.stdout.write("Next:")
        self.stdout.write("  1. Read lead and worker turns through the dogfood harness")
        if scenario == "file":
            self.stdout.write("  2. Report execution with observation kind workspace.file.changed")
            self.stdout.write("  3. Apply reduction for workspace.file.exists and workspace.file.content")
        else:
            self.stdout.write("  2. Report execution with observation kind runtime.health.changed")
            self.stdout.write("  3. Apply reduction for runtime.health")
        self.stdout.write("  4. Confirm progress becomes satisfied")
