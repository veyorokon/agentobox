"""
Docker container operations for e2e tests.

Wraps the Docker SDK with helpers for finding agent containers,
killing processes, and capturing logs.

Container naming convention: agentobox-agent-{agent_uuid}
Container labels: agentobox.agent = {agent_name}, agentobox.agent.id = {agent_uuid}
"""

from __future__ import annotations

import docker


class DockerOps:
    """Helper for interacting with agent Docker containers."""

    def __init__(self, client: docker.DockerClient):
        self._client = client

    def find_agent_container(
        self, agent_name: str, agent_id: str = ""
    ) -> docker.models.containers.Container | None:
        """Find a running agent container by label or naming convention.

        Naming convention: agentobox-agent-{agent_uuid}
        Labels: agentobox.agent={agent_name}, agentobox.agent.id={agent_uuid}
        """
        # Prefer ID-based label lookup (globally unique, no ambiguity)
        if agent_id:
            containers = self._client.containers.list(
                filters={"label": f"agentobox.agent.id={agent_id}"}
            )
            if containers:
                return containers[0]

        # Fallback: name-based label lookup
        containers = self._client.containers.list(
            filters={"label": f"agentobox.agent={agent_name}"}
        )
        if containers:
            return containers[0]
        return None

    def kill_process(
        self, container_id: str, process_name: str, signal: int = 9
    ) -> str:
        """Kill a process inside a container. Default signal is SIGKILL (9).

        SIGKILL (9) produces a non-zero exit → ERROR status.
        SIGTERM (15) allows graceful shutdown → STOPPED status.
        """
        container = self._client.containers.get(container_id)
        exit_code, output = container.exec_run(
            ["pkill", f"-{signal}", "-f", process_name], user="root"
        )
        return output.decode("utf-8", errors="replace")

    def exec_in_container(
        self, container_id: str, cmd: list[str], user: str = "root"
    ) -> tuple[int, str]:
        """Run a command inside a container. Returns (exit_code, output)."""
        container = self._client.containers.get(container_id)
        exit_code, output = container.exec_run(cmd, user=user)
        return exit_code, output.decode("utf-8", errors="replace")

    def get_container_logs(self, container_id: str, tail: int = 100) -> str:
        """Get the last N lines of container logs."""
        container = self._client.containers.get(container_id)
        return container.logs(tail=tail).decode("utf-8", errors="replace")

    def stop_container(self, container_id: str, timeout: int = 1) -> None:
        """Stop a container. Sends SIGTERM, then SIGKILL after timeout.

        Short timeout (1s) ensures the container dies quickly for tests.
        This produces a container state of "exited" which the reconciliation
        loop detects and marks as ERROR.
        """
        container = self._client.containers.get(container_id)
        container.stop(timeout=timeout)

    def container_is_running(self, container_id: str) -> bool:
        """Check if a container is in running state."""
        try:
            container = self._client.containers.get(container_id)
            return container.status == "running"
        except docker.errors.NotFound:
            return False
