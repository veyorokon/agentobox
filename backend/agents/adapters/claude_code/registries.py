"""Claude Code-specific registries — models, MCP servers, team templates.

These are agent-type-specific data that other adapters (Codex, Gemini) would
replace with their own equivalents. Kept separate from the adapter class
so the data is easy to find and modify.
"""

# Available models for agent provisioning.
# value = Anthropic model ID passed to Claude Code via --model
# label = human-friendly name shown in the dashboard
MODELS_REGISTRY = [
    {"value": "claude-sonnet-4-5-20250929", "label": "Sonnet 4.5"},
    {"value": "claude-opus-4-20250514", "label": "Opus 4"},
    {"value": "claude-opus-4-6", "label": "Opus 4.6"},
]

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
    "computer-use": {
        "command": "node",
        "args": ["/opt/mcp-servers/computer-use/dist/main.js"],
        "compat": ["debian"],
        "instructions": """
            ## Computer Use

            You have a desktop environment with a display, mouse, and keyboard
            accessible through the `computer` MCP tool. **Use the computer
            tool for GUI interactions** — clicking, typing, scrolling, and
            taking screenshots.

            ### Desktop

            There is a dock bar at the bottom of the screen with app launchers
            (Firefox, Terminal). To open an app, click its icon in the dock.
            If the app you need is not in the dock, you may launch it from
            bash — this is the only acceptable reason to use bash for GUI apps.

            ### How to interact

            1. **Screenshot first** — before every action, take a screenshot
               to see the current screen state.
            2. **Click, type, scroll** — interact with what you see, like a
               human sitting at the computer. Click buttons, type into fields,
               scroll to find content.
            3. **Screenshot after** — verify your action had the expected
               effect before proceeding.

            ### Browser

            - Firefox is in the dock. Click its icon to open it.
            - To navigate: click the address bar, type the URL, press Enter.
            - To follow a link: click it. To go back: click the back button.
            - To search: click the search/address bar, type your query, press
              Enter.

            ### Rules

            - **Use the dock to launch apps.** Click the app icon in the
              bottom dock bar. Only use bash to launch apps not in the dock.
            - **Never use bash to type into GUI apps.** Use the computer tool's
              `type` and `key` actions instead.
            - **Always verify with screenshots.** After clicking or typing,
              take a screenshot to confirm the result before your next action.
            - **Be patient.** Pages and apps take time to load. If a click
              doesn't seem to work, take another screenshot after a moment —
              don't immediately retry.
        """,
    },
}

# Team configuration templates
# Each template defines a complete agent team with role, model, and responsibilities
TEAM_CONFIGS = {
    "solo": {
        "agents": [
            {
                "name": "team-lead",
                "role": "lead",
                "model": "claude-opus-4-6",
                "instructions": "You are the team lead and sole agent. Handle all aspects of the project.",
                "mcp_servers": ["computer-use"],
            }
        ]
    },
    "fullstack": {
        "agents": [
            {
                "name": "team-lead",
                "role": "lead",
                "model": "claude-opus-4-6",
                "instructions": "Coordinate the team, delegate tasks, review work, and maintain overall project vision.",
                "mcp_servers": ["computer-use"],
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
