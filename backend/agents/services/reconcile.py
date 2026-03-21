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
from datetime import timedelta

import docker
import structlog
from asgiref.sync import sync_to_async
from django.db.models import F
from django.utils import timezone

from agents.errors import (
    ERR_RECONCILER_LOOP_FAILED,
    ERR_RECONCILER_STATUS_CHECK_FAILED,
)
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
from agents.services.runtime_projection import read_runtime_status
from agents.services.utils import mark_agent_runtime_unavailable, terminate_sandbox

log = structlog.get_logger("abox.reconciler")

INTERVAL_S = 30
DEPLOY_GRACE_S = 120
DEPLOY_HARD_LIMIT_S = 300  # 5 min absolute max — kill regardless of container state
REASON_RECONCILER_DEAD_RUNTIME = "reconciler.dead_runtime"
REASON_RECONCILER_RUNTIME_MISSING = "reconciler.runtime_missing"
REASON_RECONCILER_STUCK_DEPLOY = "reconciler.stuck_deploy"
REASON_RECONCILER_ERROR_REAP = "reconciler.error_reap"

_task: asyncio.Task | None = None
_logged_error_reap_skip = False

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
        except Exception as exc:  # intentional: reconciliation loop must never crash — log and retry next interval
            log.exception(
                "reconciler.failed",
                error_code=ERR_RECONCILER_LOOP_FAILED,
                error_class=type(exc).__name__,
                operation="reconcile_agents",
            )


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


async def _mark_error(agent_id, error_message="", *, reason=REASON_RECONCILER_DEAD_RUNTIME):
    return await mark_agent_runtime_unavailable(
        str(agent_id),
        reason=reason,
        error_message=error_message,
    )


def _summarize_runtime_log(events: list[dict]) -> tuple[str, list[str]]:
    names = [str(event.get("event", "")).strip() for event in events if event.get("event")]
    names = [name for name in names if name]
    if not names:
        return "", []
    recent = names[-5:]
    return f"Last runtime event: {recent[-1]}", recent


async def _read_runtime_log_tail(agent, *, limit: int = 10) -> list[dict]:
    return await sync_to_async(agent.machine.runtime_log_tail, thread_sensitive=False)(limit=limit)


async def _write_runtime_diagnostics(agent, payload: dict) -> None:
    await sync_to_async(agent.machine.write_runtime_diagnostics, thread_sensitive=False)(payload)


@_db
def _mark_stopped(agent_id, *, reason=REASON_RECONCILER_ERROR_REAP):
    agent = Agent.objects.get(id=agent_id)

    # Accumulate compute time atomically before status change
    if agent.deployed_at:
        elapsed = int((timezone.now() - agent.deployed_at).total_seconds())
        Agent.objects.filter(id=agent_id).update(
            compute_seconds=F("compute_seconds") + elapsed,
        )

    # Force=True: reconciler is a recovery path — it must be able to fix
    # any stuck state, even if the transition isn't normally legal.
    transition_agent_status(agent, AgentStatus.STOPPED, reason=reason, force=True)
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
    retained_failed_agent_ids: set[str] = set()

    from config.app_config import app_config
    if app_config.reconciler.keep_failed_containers:
        retained_failed_agent_ids = set(
            str(aid)
            for aid in Agent.objects.filter(
                runtime="docker",
                status=AgentStatus.ERROR,
            ).values_list("id", flat=True)
        )

    for container in containers:
        # Match by sandbox_id (normal case) or agent.id label (provisioning window)
        agent_id_label = container.labels.get("agentobox.agent.id", "")
        if (
            container.id in active_sandbox_ids
            or agent_id_label in active_agent_ids
            or agent_id_label in retained_failed_agent_ids
        ):
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
        if container_status in ("exited", "dead", "missing"):
            # Capture crash diagnostics before marking ERROR
            crash_info = await runtime.get_crash_info(agent.sandbox_id)
            runtime_events = await _read_runtime_log_tail(agent, limit=10)
            runtime_log_summary, recent_runtime_events = _summarize_runtime_log(runtime_events)
            runtime_status = await sync_to_async(read_runtime_status, thread_sensitive=False)(agent)
            docker_events = await runtime.get_event_tail(agent.sandbox_id, limit=10)
            last_docker_action = docker_events[-1]["action"] if docker_events else ""

            # Build error message from crash info (backup path — stream.py
            # may have already set it from relay's process_exit event)
            error_msg = ""
            reason = REASON_RECONCILER_DEAD_RUNTIME
            if container_status == "missing":
                error_msg = "Runtime container is missing"
                reason = REASON_RECONCILER_RUNTIME_MISSING
            elif crash_info:
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
            if runtime_log_summary:
                error_msg = (
                    f"{error_msg}\n{runtime_log_summary}"
                    if error_msg
                    else runtime_log_summary
                )
            if container_status == "missing" and last_docker_action:
                docker_summary = f"Last docker action: {last_docker_action}"
                error_msg = f"{error_msg}\n{docker_summary}" if error_msg else docker_summary

            await _write_runtime_diagnostics(
                agent,
                {
                    "captured_at": timezone.now().isoformat(),
                    "agent_id": str(agent.id),
                    "sandbox_id": agent.sandbox_id,
                    "container_status": container_status,
                    "runtime_status": runtime_status,
                    "crash_info": crash_info or {},
                    "runtime_log_tail": runtime_events,
                    "docker_event_tail": docker_events,
                },
            )

            agent = await _mark_error(
                agent.id,
                error_message=error_msg,
                reason=reason,
            )
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
            summary = (
                "Runtime container is missing"
                if container_status == "missing"
                else (error_msg.splitlines()[-1][:200] if error_msg else "Container exited unexpectedly")
            )
            await create_feed_item(
                project_id=str(agent.project_id),
                type="error",
                agent_name=agent.name,
                agent_record=agent,
                text=summary,
            )

            event_name = "reconciler.runtime_missing" if container_status == "missing" else "reconciler.dead_container"
            log.info(
                event_name,
                agent_id=str(agent.id),
                agent_name=agent.name,
                container_status=container_status,
                exit_code=crash_info.get("exit_code") if crash_info else None,
                oom_killed=crash_info.get("oom_killed") if crash_info else None,
                last_runtime_event=recent_runtime_events[-1] if recent_runtime_events else "",
                recent_runtime_events=recent_runtime_events,
                last_docker_action=last_docker_action,
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
            except Exception as exc:  # intentional: can't check status — fall through to kill
                agent_log.debug(
                    "reconciler.status_check_failed",
                    error_code=ERR_RECONCILER_STATUS_CHECK_FAILED,
                    error_class=type(exc).__name__,
                    operation="get_container_status",
                )

        await terminate_sandbox(agent, agent_log)
        agent = await _mark_error(agent.id, reason=REASON_RECONCILER_STUCK_DEPLOY)
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
    from config.app_config import app_config

    global _logged_error_reap_skip
    if app_config.reconciler.keep_failed_containers:
        if not _logged_error_reap_skip:
            log.info("reconciler.error_reap_skipped", keep_failed_containers=True)
            _logged_error_reap_skip = True
        return

    _logged_error_reap_skip = False

    reap_cutoff = now - timedelta(seconds=app_config.reconciler.reap_delay_s)
    errored_agents = await _get_agents(
        status=AgentStatus.ERROR,
        updated_at__lt=reap_cutoff,
    )

    for agent in errored_agents:
        await terminate_sandbox(agent, log.bind(agent_id=str(agent.id)))
        agent = await _mark_stopped(agent.id, reason=REASON_RECONCILER_ERROR_REAP)
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
