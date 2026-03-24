"""
Proxy client for the official MCP server registry at registry.modelcontextprotocol.io.

Provides search_registry() which forwards search queries to the upstream
registry API and returns the response. Used by the GraphQL searchMcpRegistry
query so the dashboard can browse available MCP servers without a direct
browser-to-registry connection (avoids CORS and keeps the registry URL
server-side).
"""
import structlog
import httpx

log = structlog.get_logger("abox.mcp")

REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0"


def _derive_stdio_launch_spec(server: dict) -> dict | None:
    """Derive a runtime MCP config from one public registry server payload.

    First slice: support package-backed stdio servers with explicit runtime
    hints. This is enough for npm/npx-backed MCPs like computer-use-mcp.
    """
    name = server.get("name", "")
    version = server.get("version", "")

    for pkg in server.get("packages", []):
        transport = (pkg.get("transport") or {}).get("type", "stdio")
        if transport != "stdio":
            continue

        registry_type = pkg.get("registryType", "")
        identifier = pkg.get("identifier", "")
        runtime_hint = pkg.get("runtimeHint", "")
        package_version = pkg.get("version") or version

        if registry_type == "npm" and runtime_hint == "npx" and identifier:
            package_ref = f"{identifier}@{package_version}" if package_version else identifier
            return {
                "command": "npx",
                "args": ["-y", package_ref],
                "env": {},
                "source": "registry",
                "registry_name": name,
                "registry_type": registry_type,
                "package_identifier": identifier,
                "package_version": package_version,
                "runtime_hint": runtime_hint,
                "transport_type": transport,
            }

    return None


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
        log.warning("mcp.registry_search_failed", error=str(exc), query=query)
        return {"servers": [], "metadata": {}}


async def resolve_public_registry_mcp_servers(names: list[str]) -> tuple[dict, list[str]]:
    """Resolve public registry MCP names into canonical runtime config entries.

    Returns `(resolved, unresolved)` where `resolved` is a dict suitable for
    `agent.mcp_servers`.
    """
    resolved: dict[str, dict] = {}
    unresolved: list[str] = []

    async with httpx.AsyncClient(timeout=10.0) as client:
        for name in names:
            try:
                resp = await client.get(
                    f"{REGISTRY_BASE}/servers",
                    params={"limit": 20, "version": "latest", "search": name},
                )
                resp.raise_for_status()
            except (httpx.HTTPError, httpx.TimeoutException) as exc:
                raise ValueError(f"Failed to resolve MCP server '{name}' from registry: {exc}") from exc

            data = resp.json()
            match = next(
                (
                    entry.get("server", {})
                    for entry in data.get("servers", [])
                    if entry.get("server", {}).get("name") == name
                ),
                None,
            )
            if not match:
                unresolved.append(name)
                continue

            spec = _derive_stdio_launch_spec(match)
            if spec is None:
                unresolved.append(name)
                continue
            resolved[name] = spec

    return resolved, unresolved
