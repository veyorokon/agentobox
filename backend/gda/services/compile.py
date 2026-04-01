from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime

from gda_kernel import RunSpec, compile_project_to_run_spec

from projects.models import Project


def compile_run_spec_for_project(
    *,
    project: Project,
    task_bundle: Mapping[str, object] | object,
    now: datetime,
    world_ref: str,
) -> RunSpec:
    return compile_project_to_run_spec(
        project={
            "project_id": str(project.id),
            "metadata": {
                "project_name": project.name,
            },
        },
        task_bundle=task_bundle,
        now=now,
        world_ref=world_ref,
    )
