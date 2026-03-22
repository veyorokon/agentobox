"""
Sync GraphQL client for e2e tests.

Wraps httpx with authenticated headers and typed convenience methods.
Fails loud on GraphQL errors — no silent fallbacks.
"""

from __future__ import annotations

import httpx


class GraphQLError(Exception):
    """Raised when the GraphQL response contains errors."""

    def __init__(self, errors: list[dict], query: str):
        self.errors = errors
        self.query = query
        messages = "; ".join(e.get("message", str(e)) for e in errors)
        super().__init__(f"GraphQL errors: {messages}")


class AboxGraphQL:
    """Sync GraphQL client with Bearer auth."""

    def __init__(self, url: str, token: str, timeout: float = 30.0):
        self._url = url
        self._client = httpx.Client(
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
            timeout=timeout,
        )

    def execute(self, query: str, variables: dict | None = None) -> dict:
        """Execute a GraphQL operation. Raises GraphQLError on errors."""
        payload: dict = {"query": query}
        if variables:
            payload["variables"] = variables
        resp = self._client.post(self._url, json=payload)
        resp.raise_for_status()
        body = resp.json()
        if "errors" in body:
            raise GraphQLError(body["errors"], query)
        return body["data"]

    # -- Agent operations --

    def query_agent(self, agent_id: str) -> dict | None:
        data = self.execute(
            """
            query ($agentId: ID!) {
                agent(agentId: $agentId) {
                    id name runtime lifecycleStatus errorMessage phase task
                    mode attentionLevel role cost turns relayConnected
                    desiredStatus isConverged previewState
                    lifecycleAttempts {
                        id kind status step attemptNo correlationId
                        errorCode errorDetail startedAt finishedAt
                    }
                }
            }
            """,
            {"agentId": agent_id},
        )
        return data["agent"]

    def query_agents(self, project_id: str) -> list[dict]:
        data = self.execute(
            """
            query ($projectId: ID!) {
                agents(projectId: $projectId) {
                    id name runtime lifecycleStatus errorMessage phase task
                    mode attentionLevel role relayConnected cost turns
                    desiredStatus isConverged previewState
                }
            }
            """,
            {"projectId": project_id},
        )
        return data["agents"]

    def create_agent(self, project_id: str, name: str, **kwargs) -> dict:
        variables = {
            "input": {
                "projectId": project_id,
                "name": name,
                "model": kwargs.get("model", "claude-sonnet-4-5-20250929"),
                "workspacePath": kwargs.get("workspacePath", ""),
                "instructions": kwargs.get("instructions", ""),
                "role": kwargs.get("role", "worker"),
                "mode": kwargs.get("mode", "auto"),
            }
        }
        if "mcpServers" in kwargs:
            variables["input"]["mcpServers"] = kwargs["mcpServers"]
        if "tags" in kwargs:
            variables["input"]["tags"] = kwargs["tags"]
        if "agentType" in kwargs:
            variables["input"]["agentType"] = kwargs["agentType"]

        data = self.execute(
            """
            mutation ($input: CreateAgentInput!) {
                createAgent(input: $input) {
                    id name lifecycleStatus errorMessage phase task
                    mode attentionLevel role
                }
            }
            """,
            variables,
        )
        return data["createAgent"]

    def kill_agent(self, agent_id: str) -> bool:
        data = self.execute(
            """
            mutation ($agentId: ID!) {
                killAgent(agentId: $agentId)
            }
            """,
            {"agentId": agent_id},
        )
        return data["killAgent"]

    def remove_agent(self, agent_id: str) -> bool:
        data = self.execute(
            """
            mutation ($agentId: ID!) {
                removeAgent(agentId: $agentId)
            }
            """,
            {"agentId": agent_id},
        )
        return data["removeAgent"]

    # -- Messaging --

    def send_message(
        self, project_id: str, text: str, recipients: list[dict]
    ) -> bool:
        data = self.execute(
            """
            mutation ($projectId: ID!, $text: String!, $recipients: [RecipientInput!]!) {
                sendMessage(projectId: $projectId, text: $text, recipients: $recipients)
            }
            """,
            {
                "projectId": project_id,
                "text": text,
                "recipients": recipients,
            },
        )
        return data["sendMessage"]

    # -- Feed --

    def query_feed(self, project_id: str) -> list[dict]:
        data = self.execute(
            """
            query ($projectId: ID!) {
                teamFeed(projectId: $projectId) {
                    id type agent agentId text isError
                    from to summary cost turns duration
                }
            }
            """,
            {"projectId": project_id},
        )
        return data["teamFeed"]

    # -- Projects --

    def create_project(self, name: str, description: str = "") -> dict:
        data = self.execute(
            """
            mutation ($input: CreateProjectInput!) {
                createProject(input: $input) {
                    id name description
                }
            }
            """,
            {"input": {"name": name, "description": description}},
        )
        return data["createProject"]

    def delete_project(self, project_id: str) -> bool:
        data = self.execute(
            """
            mutation ($id: ID!) {
                deleteProject(id: $id)
            }
            """,
            {"id": project_id},
        )
        return data["deleteProject"]

    # -- Incidents --

    def capture_incident(self, agent_id: str, note: str = "") -> dict:
        data = self.execute(
            """
            mutation ($input: CaptureIncidentInput!) {
                captureIncident(input: $input) {
                    incidentId
                    agentId
                    projectId
                    createdAt
                }
            }
            """,
            {"input": {"agentId": agent_id, "note": note}},
        )
        return data["captureIncident"]

    def query_incident(self, incident_id: str) -> dict | None:
        data = self.execute(
            """
            query ($incidentId: ID!) {
                incident(incidentId: $incidentId) {
                    id
                    agentId
                    projectId
                    note
                    windowMinutes
                    bundle
                    collectionErrors
                    createdAt
                }
            }
            """,
            {"incidentId": incident_id},
        )
        return data["incident"]

    def close(self):
        self._client.close()
