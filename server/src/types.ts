import {randomBytes} from 'node:crypto';

// ── Agent types ──────────────────────────────────────────────────────────────

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
  currentTask?: string;
  projectId?: string;
  createdAt: number;
  completedAt?: number;
}

// ── Chat types ───────────────────────────────────────────────────────────────

export interface ChatMsg {
  id: string;
  role: 'user' | 'agento';
  content: string;
  ts: string;
  target?: string;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

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

// ── Constants ────────────────────────────────────────────────────────────────

export const DOCKER_IMAGE = 'agentobox-agent';
export const VNC_PORT_BASE = 6902;
export const TMUX_PREFIX = 'abox';
export const CONTAINER_WORKSPACE = '/home/kasm-user/workspace';

export const SERVER_PORT = parseInt(process.env.ABOX_SERVER_PORT ?? '9900', 10);
export const AGENTO_HOSTNAME = process.env.ABOX_AGENTO_HOSTNAME ?? 'host.docker.internal';
export const ABOX_NETWORK = process.env.ABOX_NETWORK ?? 'agentobox';
export const EVENT_TAG = process.env.ABOX_EVENT_TAG || randomBytes(2).toString('hex');

export const VALID_STATES: AgentStatus[] = ['idle', 'working', 'completed', 'blocked', 'dead'];

// ── Agent container config generators ────────────────────────────────────────

export function agentClaudeMd(agentName: string): string {
  return `# agentobox Worker Agent

You are an agentobox worker agent. Your job is to **emulate a human user** operating a Linux desktop computer. You interact with the desktop through the \`computer-use\` MCP — clicking, typing, scrolling, and taking screenshots just like a person sitting at the screen.

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

## Task Tracking with TodoWrite

**Use TodoWrite to plan and track your work.** This is how the dashboard knows what you're doing.

- Break your task into steps using TodoWrite
- Mark each step \`in_progress\` as you start it — the \`activeForm\` text becomes your displayed task (e.g. "Browsing competitor websites")
- Mark steps \`completed\` when done
- When **all** todos are completed, you are automatically marked as \`completed\` in the dashboard

This drives your status automatically — no manual status updates needed for \`working\` and \`completed\`.

## Intent Field on Computer Actions

Every \`computer\` tool call has a required \`intent\` field. This is a brief description of what you're trying to achieve with that specific action — e.g. "Opening Netflix pricing page", "Clicking the sign-up button", "Scrolling to pricing section".

Keep it concise (under 80 chars). This is displayed as your immediate activity in the dashboard beneath your overarching task.

## Workflow

1. Start by planning your task with TodoWrite
2. Take a screenshot to see the desktop
3. Execute actions via computer-use MCP (always include \`intent\`)
4. Take another screenshot to verify the result
5. Mark TodoWrite steps completed as you go
6. Repeat until all steps are done

## Status Signaling

Most status updates are **automatic** via hooks:
- **TodoWrite** → dashboard shows your current task (\`activeForm\` of in-progress item)
- **computer-use \`intent\`** → dashboard shows your immediate action
- **All todos completed** → you're marked \`completed\`
- **Session ends** → Stop hook marks you \`completed\`

The only state you need to set **manually** is \`blocked\`:
\`\`\`bash
curl -s -X POST http://${AGENTO_HOSTNAME}:${SERVER_PORT}/api/v1/event -H 'Content-Type: application/json' -d '{"agent":"${agentName}","state":"blocked","msg":"brief description of blocker"}'
\`\`\`

Use \`blocked\` when you truly cannot proceed without external help — e.g. "need GitHub credentials", "CAPTCHA on login page".
`;
}

export function agentSettingsJson(agentName: string): string {
  return JSON.stringify({
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: `curl -s -X POST http://${AGENTO_HOSTNAME}:${SERVER_PORT}/api/v1/event -H 'Content-Type: application/json' -d '{"agent":"${agentName}","state":"completed","msg":""}'`,
              async: true,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: 'TodoWrite',
          hooks: [
            {
              type: 'command',
              command: '/opt/agentobox/hooks/post-todo.sh',
              async: true,
            },
          ],
        },
        {
          matcher: 'mcp__computer-use__computer',
          hooks: [
            {
              type: 'command',
              command: '/opt/agentobox/hooks/post-computer.sh',
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
