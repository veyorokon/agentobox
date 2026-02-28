import structlog
import httpx

log = structlog.get_logger("agents.mcp_registry")

REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0"


async def search_registry(
    query: str = "",
    limit: int = 30,
    cursor: str | None = None,
) -> dict:
    """Proxy search to official MCP registry. Returns {servers, metadata}."""
    params: dict[str, str | int] = {"limit": limit, "version": "latest"}
    if query:
        params["search"] = query
    if cursor:
        params["cursor"] = cursor

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{REGISTRY_BASE}/servers", params=params)
            resp.raise_for_status()
            return resp.json()
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        log.warning("mcp_registry_search_failed", error=str(exc), query=query)
        return {"servers": [], "metadata": {}}
