export type AgentStatus = 'idle' | 'working' | 'completed' | 'blocked' | 'dead';

export interface AgentEvent {
  ts: string;       // ISO 8601
  agent: string;
  state: AgentStatus;
  msg: string;
}

export interface AgentState {
  name: string;
  task: string;
  containerId: string;
  vncPort: number;
  tmuxSession: string;
  status: AgentStatus;
  lastEvent?: AgentEvent;
  createdAt: number;
  completedAt?: number;
}

export const DOCKER_IMAGE = 'agentobox-agent';
export const VNC_PORT_BASE = 6902;
export const TMUX_PREFIX = 'abox';
export const CONTAINER_WORKSPACE = '/home/kasm-user/workspace';

export function agentClaudeMd(agentName: string): string {
  return `# AgentBox Worker Agent

You are an AgentBox worker agent. Your job is to **emulate a human user** operating a Linux desktop computer. You interact with the desktop through the \`computer-use\` MCP — clicking, typing, scrolling, and taking screenshots just like a person sitting at the screen.

## Your Environment

- You are running **inside** an isolated Linux desktop container
- The desktop has **Google Chrome** installed
- Your Bash tool runs inside this container
- The \`computer-use\` MCP controls the desktop GUI

## Rules

- **Bash is fine for CLI tasks** — launching apps (\`google-chrome https://example.com\`), file operations, installing packages
- **ALL web/GUI interaction must use computer-use MCP** — clicking links, filling forms, scrolling pages, reading content, navigating between pages
- Once an app is open, you are a human at the screen: click, type, scroll via computer-use MCP
- Take screenshots frequently to verify what you see
- Never use Bash to scrape, curl, or automate what should be visual interaction

## Available computer-use MCP Actions

- \`get_screenshot\` — see the current desktop state
- \`left_click\`, \`right_click\`, \`double_click\`, \`middle_click\` — mouse clicks at coordinates
- \`mouse_move\` — move cursor to coordinates
- \`key\` — press keys/combos (e.g. "Return", "ctrl+l", "alt+F4")
- \`type\` — type text
- \`scroll\` — scroll at coordinates (text: "up", "down", "left", "right")
- \`multi_click\` — click multiple coordinates sequentially
- \`get_cursor_position\` — get current cursor position

## Workflow

1. Start by taking a screenshot to see the desktop
2. Plan your actions based on what you see
3. Execute actions via computer-use MCP
4. Take another screenshot to verify the result
5. Repeat until task is complete

## Status Signaling

Your orchestrator and the dashboard track your state in real time. Some transitions are automatic:
- When you receive a task, you're set to \`working\`
- When you finish responding, you're set to \`completed\`

You should **update your status** as you work so your orchestrator and observers know what you're doing. Use this command:
\`\`\`bash
curl -s -X POST http://${AGENTO_HOSTNAME}:${CALLBACK_PORT}/event -H 'Content-Type: application/json' -d '{"agent":"${agentName}","state":"STATE","msg":"brief description"}'
\`\`\`

**States you can set:**

| State | When to use |
|-------|-------------|
| \`working\` | Update the message as your activity changes — e.g. "reading documentation", "browsing google.com", "writing code", "chatting with user" |
| \`blocked\` | You cannot proceed and need help — e.g. "need GitHub credentials", "CAPTCHA on login page" |

**Guidelines:**
- Keep the message under 100 characters — it should describe what you're doing in plain language
- Update when your activity meaningfully changes, not on every tool call
- The message is used to visualize your activity (think: a pixel art sprite depicting what you're doing)
- When idle between tasks, you can set a personality message — e.g. \`idle\` / "waiting for next task" or "taking a break"
- Only use \`blocked\` when you truly cannot proceed without external help
`;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export interface AuthConfig {
  apiKey?: string;
  oauthToken?: string;
}

/** Resolve auth: explicit override > env vars. Returns `-e` flag pairs for docker. */
export function resolveAuth(override?: AuthConfig): string[][] {
  const apiKey = override?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  const oauthToken = override?.oauthToken ?? process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '';
  const envs: string[][] = [];
  if (oauthToken) envs.push(['-e', `CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`]);
  if (apiKey) envs.push(['-e', `ANTHROPIC_API_KEY=${apiKey}`]);
  return envs;
}

/** Build .claude.json content. Only needs customApiKeyResponses for API key mode. */
export function claudeConfigJson(override?: AuthConfig): string {
  const apiKey = override?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  const oauthToken = override?.oauthToken ?? process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '';
  const config: Record<string, unknown> = {
    shiftEnterKeyBindingInstalled: true,
    theme: 'dark',
    hasCompletedOnboarding: true,
  };
  if (apiKey && !oauthToken) {
    config.customApiKeyResponses = {
      approved: [apiKey.slice(-20)],
      rejected: [],
    };
  }
  return JSON.stringify(config, null, 2);
}

// ── Callback / networking ───────────────────────────────────────────────────

export const CALLBACK_PORT = 9900;
export const AGENTO_HOSTNAME = process.env.ABOX_AGENTO_HOSTNAME ?? 'host.docker.internal';
export const ABOX_NETWORK = process.env.ABOX_NETWORK ?? 'agentobox';

// Event tag for distinguishing injected events from user messages in Agento's conversation.
// Set via env var in production; falls back to random 4-char hex for local dev.
import {randomBytes} from 'node:crypto';
export const EVENT_TAG = process.env.ABOX_EVENT_TAG || randomBytes(2).toString('hex');

export function agentSettingsJson(agentName: string): string {
  return JSON.stringify({
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: `curl -s -X POST http://${AGENTO_HOSTNAME}:${CALLBACK_PORT}/event -H 'Content-Type: application/json' -d '{"agent":"${agentName}","state":"completed","msg":""}'`,
              async: true,
            },
          ],
        },
      ],
    },
  }, null, 2);
}

export const AGENT_MCP_JSON = JSON.stringify({
  mcpServers: {
    'computer-use': {
      type: 'http',
      url: 'http://localhost:8808/mcp',
    },
  },
}, null, 2);
