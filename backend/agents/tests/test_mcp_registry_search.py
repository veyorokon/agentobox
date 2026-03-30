import pytest


pytestmark = pytest.mark.unit


def test_describe_public_registry_server_support_accepts_npx_stdio_package():
    from agents.services.mcp_registry import describe_public_registry_server_support

    supported, reason = describe_public_registry_server_support({
        "name": "io.github.example/playwright",
        "packages": [
            {
                "registryType": "npm",
                "identifier": "@playwright/mcp",
                "version": "1.0.0",
                "runtimeHint": "npx",
                "transport": {"type": "stdio"},
            },
        ],
        "remotes": [],
    })

    assert supported is True
    assert reason is None


def test_describe_public_registry_server_support_rejects_remote_only_server():
    from agents.services.mcp_registry import describe_public_registry_server_support

    supported, reason = describe_public_registry_server_support({
        "name": "io.github.example/remote-only",
        "packages": [],
        "remotes": [{"type": "sse", "url": "https://example.com/sse"}],
    })

    assert supported is False
    assert reason is not None
    assert "Remote MCPs" in reason


@pytest.mark.asyncio
async def test_search_mcp_registry_exposes_attachability_contract():
    from schema import schema

    result = None
    from unittest.mock import AsyncMock, patch

    with patch(
        "agents.services.mcp_registry.search_registry",
        new_callable=AsyncMock,
        return_value={
            "servers": [
                {
                    "server": {
                        "name": "io.github.example/remote-only",
                        "description": "Remote MCP",
                        "version": "1.0.0",
                        "websiteUrl": "https://example.com",
                        "remotes": [{"type": "sse", "url": "https://example.com/sse"}],
                        "packages": [],
                    },
                },
                {
                    "server": {
                        "name": "io.github.example/stdio",
                        "description": "Attachable MCP",
                        "version": "1.0.0",
                        "websiteUrl": "https://example.com/stdio",
                        "remotes": [],
                        "packages": [
                            {
                                "registryType": "npm",
                                "identifier": "@example/stdio-mcp",
                                "version": "1.0.0",
                                "runtimeHint": "npx",
                                "transport": {"type": "stdio"},
                            },
                        ],
                    },
                },
            ],
            "metadata": {},
        },
    ):
        result = await schema.execute(
            """
            query {
              searchMcpRegistry(query: "example", limit: 10) {
                servers {
                  name
                  attachable
                  unsupportedReason
                }
              }
            }
            """,
            context_value={"request": None},
        )

    assert result.errors is None, f"Query errors: {result.errors}"
    servers = {s["name"]: s for s in result.data["searchMcpRegistry"]["servers"]}
    assert servers["io.github.example/remote-only"]["attachable"] is False
    assert "Remote MCPs" in servers["io.github.example/remote-only"]["unsupportedReason"]
    assert servers["io.github.example/stdio"]["attachable"] is True
    assert servers["io.github.example/stdio"]["unsupportedReason"] is None
