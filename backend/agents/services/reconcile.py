"""
Background reconciliation loop for agents.

Detects orphaned containers, dead containers, and stuck deploys — then
cleans up. Runs inside the backend process (no extra services).

With the WebSocket relay, heartbeat-based staleness detection is replaced
by WS disconnect events. This loop handles cases where containers die
without a clean disconnect.

NOTE: This runs inside asyncio.create_task() where Django's
CurrentThreadExecutor is unavailable. All ORM calls MUST use
@sync_to_async(thread_sensitive=False) — never async ORM (asave, async for).
"""

import asyncio
import os
from datetime import timedelta

import docker
import structlog
from asgiref.sync import sync_to_async
from django.db.models import F
from django.utils import timezone

from agents.models import Agent, AgentLifecycleAttempt, AgentLifecycleAttemptStatus, AgentStatus
from agents.services.lifecycle import transition_agent_status
from agents.services.broadcast import broadcast_agent_update
from agents.services.feed import create_feed_item
from agents.services.lifecycle import (
    ERR_LIFECYCLE_RUNTIME_DEAD,
    ERR_LIFECYCLE_STUCK_DEPLOY,
    fail_active_lifecycle_attempts,
    succeed_active_lifecycle_attempts,
)
from agents.services.utils import terminate_sandbox

log = structlog.get_logger("abox.reconciler")

INTERVAL_S = 30
DEPLOY_GRACE_S = 120
DEPLOY_HARD_LIMIT_S = 300  # 5 min absolute max — kill regardless of container state
ERROR_REAP_GRACE_S = int(os.environ.get("AGENT_REAP_DELAY_S", "60"))

_task: asyncio.Task | None = None

# Decorator for sync DB operations in background tasks
_db = sync_to_async(thread_sensitive=False)


def ensure_running():
    """Idempotent: start the reconciliation loop if not already running."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())
        log.info("reconciler.started")


async def _loop():
    """Run reconciliation every INTERVAL_S. Never exits unless cancelled."""
    while True:
        await asyncio.sleep(INTERVAL_S)
        try:
            await reconcile_agents()
        except Exception:  # intentional: reconciliation loop must never crash — log and retry next interval
            log.exception("reconciler.failed")


async def reconcile_agents():
    """Single reconciliation pass for all agents."""
    now = timezone.now()

    await _reap_orphans()
    await _detect_dead_containers()
    await _detect_stuck_deploys(now)
    await _reap_errored_agents(now)
    await _reconcile_lifecycle_attempts(now)


async def recover_lifecycle_attempts() -> None:
    """Public entry point to finalize dangling lifecycle attempts once."""
    await _reconcile_lifecycle_attempts(timezone.now())


# ---------------------------------------------------------------------------
# Sync DB helpers
# ---------------------------------------------------------------------------

@_db
def _get_agents(**filters):
    return list(Agent.objects.filter(**filters))


@_db
def _mark_error(agent_id, error_message=""):
    agent = Agent.objects.get(id=agent_id)

    # Accumulate compute time atomically before status change
    if agent.deployed_at:
        elapsed = int((timezone.now() - agent.deployed_at).total_seconds())
        Agent.objects.filter(id=agent_id).update(
            compute_seconds=F("compute_seconds") + elapsed,
        )

    # Force=True: reconciler is a recovery path — it must be able to fix
    # any stuck state, even if the transition isn't normally legal.
    transition_agent_status(agent, AgentStatus.ERROR, reason="reconciler", force=True)
    agent.deployed_at = None
    update_fields = ["status", "deployed_at", "updated_at"]
    # Only write error_message if not already set (stream.py may have set it first)
    if error_message and not agent.error_message:
        agent.error_message = error_message[:2000]
        update_fields.append("error_message")
    agent.save(update_fields=update_fields)
    return agent


@_db
def _mark_stopped(agent_id):
    agent = Agent.objects.get(id=agent_id)

    # Accumulate compute time atomically before status change
    if agent.deployed_at:
        elapsed = int((timezone.now() - agent.deployed_at).total_seconds())
        Agent.objects.filter(id=agent_id).update(
            compute_seconds=F("compute_seconds") + elapsed,
        )

    # Force=True: reconciler is a recovery path — it must be able to fix
    # any stuck state, even if the transition isn't normally legal.
    transition_agent_status(agent, AgentStatus.STOPPED, reason="reconciler_reap", force=True)
    agent.deployed_at = None
    agent.save(update_fields=["status", "deployed_at", "updated_at"])
    return agent


@_db
def _get_running_lifecycle_attempts():
    return list(
        AgentLifecycleAttempt.objects.filter(
            status=AgentLifecycleAttemptStatus.RUNNING,
        ).select_related("agent")
    )


# ---------------------------------------------------------------------------
# Step 1: Reap orphaned Docker containers
# ---------------------------------------------------------------------------

@_db
def _reap_orphans_sync():
    """Remove containers labeled agentobox.managed=true with no matching active agent.

    Matches by both sandbox_id (container.id) AND agent.id label. The label
    check covers the window between container creation and sandbox_id being
    saved to the DB — during provisioning, sandbox_id is empty until
    _save_provisioned commits.
    """
    from agents.runtimes import get_runtime
    client = get_runtime("docker")._client
    try:
        containers = client.containers.list(
            all=True,
            filters={"label": "agentobox.managed=true"},
        )
    except docker.errors.DockerException:
        log.exception("reconciler.docker_list_failed")
        return

    active_agents = Agent.objects.filter(
        runtime="docker",
        status__in=[AgentStatus.DEPLOYING, AgentStatus.IDLE, AgentStatus.RUNNING, AgentStatus.WAITING],
    )
    active_sandbox_ids = set(active_agents.values_list("sandbox_id", flat=True))
    active_agent_ids = set(str(aid) for aid in active_agents.values_list("id", flat=True))

    for container in containers:
        # Match by sandbox_id (normal case) or agent.id label (provisioning window)
        agent_id_label = container.labels.get("agentobox.agent.id", "")
        if container.id in active_sandbox_ids or agent_id_label in active_agent_ids:
            continue
        try:
            container.stop(timeout=5)
            container.remove(force=True)
            log.info("reconciler.orphan_reaped", container_id=container.id[:12])
        except docker.errors.DockerException:
            log.exception("reconciler.orphan_reap_failed", container_id=container.id[:12])


async def _reap_orphans():
    await _reap_orphans_sync()


# ---------------------------------------------------------------------------
# Step 2: Detect dead containers
# ---------------------------------------------------------------------------

async def _detect_dead_containers():
    """Mark agents ERROR when their Docker container is exited/dead/missing."""
    from agents.runtimes import get_runtime
    runtime = get_runtime("docker")
    agents = await _get_agents(
        runtime="docker",
        status__in=[AgentStatus.IDLE, AgentStatus.RUNNING],
        sandbox_id__gt="",
    )

    for agent in agents:
        container_status = await runtime.get_status(agent.sandbox_id)
        if container_status in ("exited", "dead"):
            # Capture crash diagnostics before marking ERROR
            crash_info = await runtime.get_crash_info(agent.sandbox_id)

            # Build error message from crash info (backup path — stream.py
            # may have already set it from relay's process_exit event)
            error_msg = ""
            if crash_info:
                parts = []
                exit_code = crash_info.get("exit_code", -1)
                if crash_info.get("oom_killed"):
                    parts.append("Container killed: out of memory (OOM)")
                elif exit_code != 0:
                    parts.append(f"Container exited with code {exit_code}")
                logs = crash_info.get("logs", "").strip()
                if logs:
                    # Take last 10 lines — most relevant for diagnosis
                    tail = "\n".join(logs.splitlines()[-10:])
                    parts.append(tail)
                error_msg = "\n".join(parts)

            agent = await _mark_error(agent.id, error_message=error_msg)
            await fail_active_lifecycle_attempts(
                str(agent.id),
                step="runtime_dead",
                error_code=ERR_LIFECYCLE_RUNTIME_DEAD,
                error_detail=error_msg or "Container exited unexpectedly",
                metadata={"container_status": container_status},
            )
            await broadcast_agent_update(agent)

            # Create error feed item so dashboard shows WHY the agent crashed
            # (backup path — stream.py creates one from relay's process_exit
            # event, but if relay never sent it, this is the only record)
            summary = error_msg.splitlines()[-1][:200] if error_msg else "Container exited unexpectedly"
            await create_feed_item(
                project_id=str(agent.project_id),
                type="error",
                agent_name=agent.name,
                agent_record=agent,
                text=summary,
            )

            log.info(
                "reconciler.dead_container",
                agent_id=str(agent.id),
                agent_name=agent.name,
                container_status=container_status,
                exit_code=crash_info.get("exit_code") if crash_info else None,
                oom_killed=crash_info.get("oom_killed") if crash_info else None,
            )


# ---------------------------------------------------------------------------
# Step 3: Detect stuck deploys
# ---------------------------------------------------------------------------

async def _detect_stuck_deploys(now):
    """Mark DEPLOYING agents ERROR when they exceed DEPLOY_GRACE_S.

    Two-tier timeout:
    - Soft (DEPLOY_GRACE_S=120s): kill if container is dead/missing, skip if running
    - Hard (DEPLOY_HARD_LIMIT_S=300s): kill regardless — something is fundamentally broken

    A running container past the soft deadline may just be slow (large workspace,
    network latency). A dead container past the soft deadline is genuinely stuck.
    """
    from agents.runtimes import get_runtime

    deploy_cutoff = now - timedelta(seconds=DEPLOY_GRACE_S)
    hard_cutoff = now - timedelta(seconds=DEPLOY_HARD_LIMIT_S)

    stuck_agents = await _get_agents(
        status=AgentStatus.DEPLOYING,
        updated_at__lt=deploy_cutoff,
    )

    for agent in stuck_agents:
        agent_log = log.bind(agent_id=str(agent.id), agent_name=agent.name)
        is_hard_stuck = agent.updated_at < hard_cutoff

        # Readiness probe: check if container is still alive before killing.
        # Only applies to soft-deadline agents with a known sandbox.
        if not is_hard_stuck and agent.sandbox_id and agent.runtime == "docker":
            try:
                runtime = get_runtime(agent.runtime)
                container_status = await runtime.get_status(agent.sandbox_id)
                if container_status == "running":
                    agent_log.info("reconciler.deploy_still_alive")
                    continue  # Container alive — give it more time
            except Exception:  # intentional: can't check status — fall through to kill
                pass

        await terminate_sandbox(agent, agent_log)
        agent = await _mark_error(agent.id)
        await fail_active_lifecycle_attempts(
            str(agent.id),
            step="stuck_deploy",
            error_code=ERR_LIFECYCLE_STUCK_DEPLOY,
            error_detail="Agent exceeded deploy timeout",
            metadata={"hard_timeout": is_hard_stuck},
        )
        await broadcast_agent_update(agent)
        agent_log.info(
            "reconciler.stuck_deploy",
            hard_timeout=is_hard_stuck,
        )


# ---------------------------------------------------------------------------
# Step 4: Auto-reap errored agents
# ---------------------------------------------------------------------------

async def _reap_errored_agents(now):
    """Terminate and stop agents stuck in ERROR beyond ERROR_REAP_GRACE_S.

    Logs are already persisted (events in DB, process_exit with stderr), so
    keeping dead containers alive wastes resources. The grace period ensures
    final relay events have time to flush before cleanup.
    """

    reap_cutoff = now - timedelta(seconds=ERROR_REAP_GRACE_S)
    errored_agents = await _get_agents(
        status=AgentStatus.ERROR,
        updated_at__lt=reap_cutoff,
    )

    for agent in errored_agents:
        await terminate_sandbox(agent, log.bind(agent_id=str(agent.id)))
        agent = await _mark_stopped(agent.id)
        await broadcast_agent_update(agent)
        log.info(
            "reconciler.error_reaped",
            agent_id=str(agent.id),
            agent_name=agent.name,
        )


async def _reconcile_lifecycle_attempts(now):
    """Finalize dangling lifecycle attempts based on current agent state."""
    attempts = await _get_running_lifecycle_attempts()
    for attempt in attempts:
        agent = attempt.agent
        if agent.status in (AgentStatus.IDLE, AgentStatus.RUNNING, AgentStatus.WAITING):
            await succeed_active_lifecycle_attempts(
                str(agent.id),
                step="agent_available",
                metadata={"attempt_id": str(attempt.id)},
            )
            continue

        if agent.status in (AgentStatus.ERROR, AgentStatus.STOPPED):
            await fail_active_lifecycle_attempts(
                str(agent.id),
                step="agent_terminal_before_ready",
                error_code="ERR-LIFECYCLE-TERMINAL-BEFORE-READY",
                error_detail=agent.error_message or f"Agent entered {agent.status}",
                metadata={"attempt_id": str(attempt.id)},
            )
            continue

        age_s = int((now - attempt.started_at).total_seconds())
        if agent.status == AgentStatus.DEPLOYING and age_s > DEPLOY_HARD_LIMIT_S:
            await fail_active_lifecycle_attempts(
                str(agent.id),
                step="attempt_timeout",
                error_code=ERR_LIFECYCLE_STUCK_DEPLOY,
                error_detail="Lifecycle attempt exceeded hard deploy timeout",
                metadata={"attempt_id": str(attempt.id), "age_s": age_s},
            )
