"""
Background reconciliation loop for Docker agents.

Detects orphaned containers, dead containers, stale heartbeats, and stuck
deploys — then cleans up. Runs inside the backend process (no extra services).

Started lazily from stream_events() on the first relay heartbeat.

NOTE: This runs inside asyncio.create_task() where Django's
CurrentThreadExecutor is unavailable. All ORM calls MUST use
@sync_to_async(thread_sensitive=False) — never async ORM (asave, async for).
"""

import asyncio
from datetime import timedelta

import docker
import structlog
from asgiref.sync import sync_to_async
from django.utils import timezone

from agents.models import Agent, AgentStatus
from agents.services.broadcast import broadcast_agent_update

log = structlog.get_logger("agents.reconcile")

INTERVAL_S = 30
HEARTBEAT_STALE_S = 30
DEPLOY_GRACE_S = 120

_task: asyncio.Task | None = None

# Decorator for sync DB operations in background tasks
_db = sync_to_async(thread_sensitive=False)


def ensure_running():
    """Idempotent: start the reconciliation loop if not already running."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())
        log.info("reconciler_started")


async def _loop():
    """Run reconciliation every INTERVAL_S. Never exits unless cancelled."""
    while True:
        await asyncio.sleep(INTERVAL_S)
        try:
            await reconcile_docker_agents()
        except Exception:
            log.exception("reconciliation_failed")


async def reconcile_docker_agents():
    """Single reconciliation pass for Docker agents."""
    now = timezone.now()

    await _reap_orphans()
    await _detect_dead_containers()
    await _detect_stale_heartbeats(now)
    await _detect_stuck_deploys(now)


# ---------------------------------------------------------------------------
# Sync DB helpers
# ---------------------------------------------------------------------------

@_db
def _get_agents(**filters):
    return list(Agent.objects.filter(**filters))


@_db
def _mark_error(agent_id):
    agent = Agent.objects.get(id=agent_id)
    agent.status = AgentStatus.ERROR
    agent.save(update_fields=["status"])
    return agent


# ---------------------------------------------------------------------------
# Step 1: Reap orphaned Docker containers
# ---------------------------------------------------------------------------

@_db
def _reap_orphans_sync():
    """Remove containers labeled agentobox.managed=true with no matching active agent."""
    from agents.runtimes import get_runtime
    client = get_runtime("docker")._client
    try:
        containers = client.containers.list(
            filters={"label": "agentobox.managed=true"}
        )
    except docker.errors.DockerException:
        log.exception("docker_list_failed")
        return

    active_sandbox_ids = set(
        Agent.objects.filter(
            runtime="docker",
            status__in=[AgentStatus.DEPLOYING, AgentStatus.IDLE, AgentStatus.RUNNING],
        ).values_list("sandbox_id", flat=True)
    )

    for container in containers:
        if container.id not in active_sandbox_ids:
            try:
                container.stop(timeout=5)
                container.remove(force=True)
                log.info("orphan_reaped", container_id=container.id[:12])
            except docker.errors.DockerException:
                log.exception("orphan_reap_failed", container_id=container.id[:12])


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
            agent = await _mark_error(agent.id)
            await broadcast_agent_update(agent)
            log.info(
                "dead_container_detected",
                agent_id=str(agent.id),
                agent_name=agent.name,
                container_status=container_status,
            )


# ---------------------------------------------------------------------------
# Step 3: Detect stale heartbeats
# ---------------------------------------------------------------------------

async def _detect_stale_heartbeats(now):
    """Mark agents ERROR when relay hasn't posted a heartbeat in >HEARTBEAT_STALE_S."""
    stale_cutoff = now - timedelta(seconds=HEARTBEAT_STALE_S)
    stale_agents = await _get_agents(
        runtime="docker",
        status__in=[AgentStatus.IDLE, AgentStatus.RUNNING],
        last_heartbeat_at__isnull=False,
        last_heartbeat_at__lt=stale_cutoff,
    )

    for agent in stale_agents:
        agent = await _mark_error(agent.id)
        await broadcast_agent_update(agent)
        log.info(
            "stale_heartbeat_detected",
            agent_id=str(agent.id),
            agent_name=agent.name,
        )


# ---------------------------------------------------------------------------
# Step 4: Detect stuck deploys
# ---------------------------------------------------------------------------

async def _detect_stuck_deploys(now):
    """Mark DEPLOYING agents ERROR when they exceed DEPLOY_GRACE_S with no heartbeat."""
    deploy_cutoff = now - timedelta(seconds=DEPLOY_GRACE_S)
    from agents.runtimes import get_runtime
    runtime = get_runtime("docker")

    stuck_agents = await _get_agents(
        runtime="docker",
        status=AgentStatus.DEPLOYING,
        created_at__lt=deploy_cutoff,
        last_heartbeat_at__isnull=True,
    )

    for agent in stuck_agents:
        if agent.sandbox_id:
            try:
                await runtime.terminate(agent.sandbox_id)
            except Exception:
                log.exception("stuck_deploy_cleanup_failed", agent_id=str(agent.id))
        agent = await _mark_error(agent.id)
        await broadcast_agent_update(agent)
        log.info(
            "stuck_deploy_detected",
            agent_id=str(agent.id),
            agent_name=agent.name,
        )
