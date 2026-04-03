from __future__ import annotations


def make_ref(kind: str, opaque_id: object) -> str:
    return f"{kind}://{opaque_id}"


def is_ref(value: str, *, kind: str | None = None) -> bool:
    if "://" not in value:
        return False
    prefix, _rest = value.split("://", 1)
    if not prefix or not _rest:
        return False
    if kind is not None:
        return prefix == kind
    return True


def agent_ref(agent_id: object) -> str:
    return make_ref("agent", agent_id)


def project_ref(project_id: object) -> str:
    return make_ref("project", project_id)


def world_ref(world_id: object) -> str:
    return make_ref("world", world_id)


def objective_ref(objective_id: object) -> str:
    return make_ref("objective", objective_id)


def goal_ref(goal_id: object) -> str:
    return make_ref("goal", goal_id)


def boundary_ref(boundary_id: object) -> str:
    return make_ref("boundary", boundary_id)


def run_ref(run_id: object) -> str:
    return make_ref("run", run_id)


def commitment_ref(commitment_id: object) -> str:
    return make_ref("commitment", commitment_id)


def observation_ref(observation_id: object) -> str:
    return make_ref("observation", observation_id)
