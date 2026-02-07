import json
import textwrap

import structlog

from agents.models import Goal
from agents.runtimes.base import Runtime
from projects.models import Project

log = structlog.get_logger("agents.provision")


async def provision_workspace(
    runtime: Runtime,
    sandbox_id: str,
    project: Project,
    goal: Goal,
) -> None:
    """Write CLAUDE.md and .claude/settings.json into the agent container."""
    op_log = log.bind(
        project_id=str(project.id), sandbox_id=sandbox_id, goal_id=str(goal.id)
    )
    op_log.info("provisioning_workspace", context_path=goal.context_path)

    # Ensure workspace directory exists
    await runtime.exec(sandbox_id, ["mkdir", "-p", goal.context_path])

    # Write CLAUDE.md
    claude_md = _build_claude_md(project, goal)
    await runtime.write_file(
        sandbox_id,
        claude_md.encode("utf-8"),
        f"{goal.context_path}/CLAUDE.md",
    )

    # Write .claude/settings.json (hooks config)
    claude_dir = f"{goal.context_path}/.claude"
    await runtime.exec(sandbox_id, ["mkdir", "-p", claude_dir])

    settings_json = _build_settings_json()
    await runtime.write_file(
        sandbox_id,
        settings_json.encode("utf-8"),
        f"{claude_dir}/settings.json",
    )

    op_log.info("workspace_provisioned")


def _build_claude_md(project: Project, goal: Goal) -> str:
    return textwrap.dedent(f"""\
        # {project.name}

        ## Goal

        {goal.text}

        ## Workspace

        You are working in `{goal.context_path}`. Stay within this directory.

        ## Meta Protocol

        You are an agentobox agent. On every response, your cognitive state is observed.
        Report honestly -- the system uses your signals to help you, not judge you.

        ### Status Values

        Use these in your structured output:

        - **working** -- actively making progress
        - **conversing** -- talking with the user, not doing task work
        - **needs_info** -- missing information needed to proceed
        - **blocked** -- cannot proceed, need external help
        - **completed** -- goal is satisfied
        - **goal_changed** -- the goal has evolved or been refined

        ### Rules

        1. Stay focused on the goal above
        2. Work within the context path
        3. If you get stuck, report `needs_info` or `blocked` -- the system will try to help
        4. When done, report `completed`
        5. If the goal changes, report `goal_changed`
    """)


def _build_settings_json() -> str:
    settings = {
        "theme": "dark",
        "hooks": {
            "SessionStart": [
                {
                    "matcher": "*",
                    "hooks": [
                        {
                            "type": "command",
                            "command": "bash /home/computeruse/hooks/session-start.sh",
                        }
                    ],
                }
            ],
            "PostToolUse": [
                {
                    "matcher": "*",
                    "hooks": [
                        {
                            "type": "command",
                            "command": "bash /home/computeruse/hooks/post-tool.sh",
                        }
                    ],
                }
            ],
        }
    }
    return json.dumps(settings, indent=2)
