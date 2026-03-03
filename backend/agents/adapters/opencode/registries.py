"""OpenCode-specific registries — models, MCP servers, team templates.

OpenCode supports multiple LLM providers via the provider/model format.
Models are organized by provider (Anthropic, OpenAI, Google).

MCP servers use OpenCode's config format: embedded in opencode.json under
the "mcp" key, with {type, command/url, args, environment} structure.
"""

# Available models for OpenCode agents.
# value = provider/model format used by OpenCode's --model flag
# label = human-friendly name shown in the dashboard
MODELS_REGISTRY = [
    # Anthropic
    {"value": "anthropic/claude-sonnet-4-5-20250929", "label": "Sonnet 4.5 (Anthropic)"},
    {"value": "anthropic/claude-opus-4-20250514", "label": "Opus 4 (Anthropic)"},
    {"value": "anthropic/claude-opus-4-6", "label": "Opus 4.6 (Anthropic)"},
    # OpenAI
    {"value": "openai/gpt-4.1", "label": "GPT-4.1 (OpenAI)"},
    {"value": "openai/o3", "label": "o3 (OpenAI)"},
    # Google
    {"value": "google/gemini-2.5-pro", "label": "Gemini 2.5 Pro (Google)"},
]

# Known MCP servers for OpenCode agents.
# OpenCode uses a different MCP config format than Claude Code:
#   {type: "local", command: [...], environment: {}}  for local servers
#   {type: "remote", url: "...", headers: {}}          for remote/HTTP servers
#
# computer-use is excluded — it's CC-specific (bundled in the CC image).
MCP_REGISTRY = {
    "playwright": {
        "command": ["npx", "@playwright/mcp@latest"],
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

# Team configuration templates
TEAM_CONFIGS = {
    "solo": {
        "agents": [
            {
                "name": "team-lead",
                "role": "lead",
                "model": "anthropic/claude-opus-4-6",
                "instructions": "You are the team lead and sole agent. Handle all aspects of the project.",
                "mcp_servers": [],
            }
        ]
    },
    "fullstack": {
        "agents": [
            {
                "name": "team-lead",
                "role": "lead",
                "model": "anthropic/claude-opus-4-6",
                "instructions": "Coordinate the team, delegate tasks, review work, and maintain overall project vision.",
                "mcp_servers": [],
            },
            {
                "name": "backend",
                "role": "worker",
                "model": "anthropic/claude-sonnet-4-5-20250929",
                "instructions": "Backend development: APIs, database models, business logic, services.",
                "mcp_servers": [],
            },
            {
                "name": "frontend",
                "role": "worker",
                "model": "anthropic/claude-sonnet-4-5-20250929",
                "instructions": "Frontend development: UI components, styling, client-side logic, user experience.",
                "mcp_servers": [],
            },
            {
                "name": "qa",
                "role": "worker",
                "model": "anthropic/claude-sonnet-4-5-20250929",
                "instructions": "Quality assurance: testing, verification, bug reports, test automation.",
                "mcp_servers": ["playwright"],
            },
        ]
    },
}
