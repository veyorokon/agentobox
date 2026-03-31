"""Claude Code-specific registries — models, MCP servers, team templates, providers.

These are agent-type-specific data that other adapters would replace with
their own equivalents. Kept separate from the adapter class so the data
is easy to find and modify.
"""

# Provider configurations for svc-apiproxy.
# Key = provider slug used in model value prefix.
# proxy_host/proxy_port = upstream target for the proxy.
# auth_header = how to send the API key upstream.
# thinking_mode = how the proxy handles thinking blocks:
#   "passthrough" — provider returns Anthropic-compatible thinking blocks, no rewriting
#   "strip" — remove thinking params from request (provider cant handle them)
# path_prefix = prepended to request path before forwarding
PROVIDER_CONFIGS = {
    "anthropic": {
        "proxy_host": "api.anthropic.com",
        "proxy_port": 443,
        "auth_header": "x-api-key",
        "thinking_mode": "passthrough",
        "path_prefix": "",
    },
    "glm": {
        "proxy_host": "open.bigmodel.cn",
        "proxy_port": 443,
        "auth_header": "authorization",
        "thinking_mode": "passthrough",
        "path_prefix": "/api/paas",
    },
    "kimi": {
        "proxy_host": "api.moonshot.cn",
        "proxy_port": 443,
        "auth_header": "authorization",
        "thinking_mode": "strip",
        "path_prefix": "",
    },
    "minimax": {
        "proxy_host": "api.minimax.chat",
        "proxy_port": 443,
        "auth_header": "authorization",
        "thinking_mode": "passthrough",
        "path_prefix": "",
    },
    "qwen": {
        "proxy_host": "dashscope-intl.aliyuncs.com",
        "proxy_port": 443,
        "auth_header": "authorization",
        "thinking_mode": "strip",
        "path_prefix": "",
    },
    "openrouter": {
        "proxy_host": "openrouter.ai",
        "proxy_port": 443,
        "auth_header": "authorization",
        "thinking_mode": "passthrough",
        "path_prefix": "/api",
    },
}

# Maps provider slug to the conventional ProjectSecret key name
# used to store that provider's API key. Dashboard uses these names
# when creating secrets; _resolve_api_key() looks them up at provision time.
PROVIDER_SECRET_KEYS = {
    "anthropic": "ANTHROPIC_API_KEY",
    "glm": "PROVIDER_KEY_GLM",
    "kimi": "PROVIDER_KEY_KIMI",
    "minimax": "PROVIDER_KEY_MINIMAX",
    "qwen": "PROVIDER_KEY_QWEN",
    "openrouter": "PROVIDER_KEY_OPENROUTER",
}

# Available models for agent provisioning.
# value = model ID passed to Claude Code via CLAUDE_MODEL.
# For non-Anthropic models, value uses "provider/model-id" format —
# the provider prefix maps to PROVIDER_CONFIGS for proxy routing.
# label = human-friendly name shown in the dashboard
MODELS_REGISTRY = [
    # Anthropic (native — no proxy rewriting needed)
    {"value": "claude-sonnet-4-5-20250929", "label": "Sonnet 4.5"},
    {"value": "claude-opus-4-20250514", "label": "Opus 4"},
    {"value": "claude-opus-4-6", "label": "Opus 4.6"},
    # Z.ai / GLM (native Anthropic endpoint)
    {"value": "glm/glm-5", "label": "GLM-5 (Z.ai)"},
    # Moonshot / Kimi
    {"value": "kimi/kimi-k2.5", "label": "Kimi K2.5 (Moonshot)"},
    # MiniMax
    {"value": "minimax/MiniMax-M1-80k", "label": "MiniMax M1 (MiniMax)"},
    # Qwen
    {"value": "qwen/qwen3-coder-plus", "label": "Qwen3 Coder Plus"},
    # OpenRouter (aggregator — Anthropic Skin translates to any provider)
    {"value": "openrouter/openai/gpt-4.1", "label": "GPT-4.1 (OpenRouter)"},
    {"value": "openrouter/google/gemini-2.5-pro", "label": "Gemini 2.5 Pro (OpenRouter)"},
    {"value": "openrouter/deepseek/deepseek-r1", "label": "DeepSeek R1 (OpenRouter)"},
]

# Per-million-token pricing (USD) for cost correction.
# The Claude Code SDK always calculates total_cost_usd using Anthropic pricing.
# For Anthropic models this is correct. For non-Anthropic models routed through
# svc-apiproxy, we recalculate from token counts × actual provider rates.
#
# Keys match the model IDs in MODELS_REGISTRY (and modelUsage keys from the SDK).
# Missing entries → fall back to SDK-reported cost (best we have).
# OpenRouter pricing varies per model and changes frequently — omitted intentionally.
MODEL_PRICING: dict[str, dict[str, float]] = {
    # Anthropic (native — SDK reports these correctly)
    "claude-sonnet-4-5-20250514": {"input": 3.0, "output": 15.0, "cache_read": 0.3, "cache_write": 3.75},
    "claude-sonnet-4-5-20250929": {"input": 3.0, "output": 15.0, "cache_read": 0.3, "cache_write": 3.75},
    "claude-opus-4-20250514": {"input": 15.0, "output": 75.0, "cache_read": 1.5, "cache_write": 18.75},
    "claude-opus-4-6-20250610": {"input": 15.0, "output": 75.0, "cache_read": 1.5, "cache_write": 18.75},
    "claude-opus-4-6": {"input": 15.0, "output": 75.0, "cache_read": 1.5, "cache_write": 18.75},
    # Z.ai / GLM
    "glm/glm-5": {"input": 0.5, "output": 2.0, "cache_read": 0.05, "cache_write": 0.5},
    # Moonshot / Kimi
    "kimi/kimi-k2.5": {"input": 2.0, "output": 8.0, "cache_read": 0.2, "cache_write": 2.0},
    # MiniMax
    "minimax/MiniMax-M1-80k": {"input": 1.1, "output": 4.4, "cache_read": 0.11, "cache_write": 1.1},
    # Qwen
    "qwen/qwen3-coder-plus": {"input": 1.6, "output": 6.4, "cache_read": 0.16, "cache_write": 1.6},
    # OpenRouter models — pricing varies, omitted. SDK cost used as-is.
}

# Known MCP servers bundled into the agent image.
# Keys match checkbox values in the deploy modal.
# Each entry has:
#   command/args: how to start the server
#   compat: list of image variants where this server works
#   instructions: behavioral guidance injected into instruction file when attached
MCP_REGISTRY = {
    "playwright": {
        "command": "npx",
        "args": ["@playwright/mcp@latest"],
        "secrets": [],
        "compat": ["debian"],
        "instructions": """
            ## Playwright

            You have Playwright MCP for browser automation and testing.
            Use it to navigate pages, click elements, fill forms, take
            screenshots, and assert page state.

            ### Usage

            - Use `browser_navigate` to open URLs
            - Use `browser_snapshot` to get the accessibility tree (preferred over screenshots)
            - Use `browser_click`, `browser_type`, `browser_fill_form` for interactions
            - Use `browser_take_screenshot` for visual verification

            ### Rules

            - Always take a snapshot or screenshot after navigation to see the page state
            - Use accessibility snapshots over screenshots when possible — they're faster and actionable
            - Close the browser when done with `browser_close`
        """,
    },
}

# MCPs included on every agent by default (unless explicitly overridden).
# Empty by default. Managed runtimes only expose bundled MCPs that are
# explicitly present in the current image/profile contract.
DEFAULT_MCPS: list[str] = []

# Team configuration templates
# Each template defines a complete agent team with role, model, and responsibilities
TEAM_CONFIGS = {
    "solo": {
        "agents": [
            {
                "name": "meta-agent",
                "role": "lead",
                "model": "claude-opus-4-6",
                "instructions": "You are the meta agent and sole agent. Handle all aspects of the project, including metacognition, decomposition, delegation, and escalation.",
                "mcp_servers": [],
            }
        ]
    },
    "fullstack": {
        "agents": [
            {
                "name": "meta-agent",
                "role": "lead",
                "model": "claude-opus-4-6",
                "instructions": "Act as the meta agent. Coordinate the project, delegate tasks to subagents, review work, and maintain overall project direction.",
                "mcp_servers": [],
            },
            {
                "name": "backend",
                "role": "worker",
                "model": "claude-sonnet-4-5-20250929",
                "instructions": "Backend development: APIs, database models, business logic, services.",
                "mcp_servers": [],
            },
            {
                "name": "frontend",
                "role": "worker",
                "model": "claude-sonnet-4-5-20250929",
                "instructions": "Frontend development: UI components, styling, client-side logic, user experience.",
                "mcp_servers": [],
            },
            {
                "name": "qa",
                "role": "worker",
                "model": "claude-sonnet-4-5-20250929",
                "instructions": "Quality assurance: testing, verification, bug reports, test automation.",
                "mcp_servers": ["playwright"],
            },
        ]
    },
}
