import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {jsonResult, errorResult} from '../utils/response.js';

const SERVER_URL = process.env.ABOX_SERVER_URL || 'http://localhost:9900';

/** Fetch helper with long timeout for blocking operations */
async function api(path: string, init?: RequestInit & {timeoutMs?: number}): Promise<Record<string, unknown>> {
  const {timeoutMs = 10_000, ...fetchInit} = init ?? {};
  const res = await fetch(`${SERVER_URL}/api/v1${path}`, {
    ...fetchInit,
    headers: {'Content-Type': 'application/json', ...fetchInit.headers},
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

// ── MCP tool registration ────────────────────────────────────────────────────

export function registerAgents(server: McpServer): void {
  server.tool(
    'create_agent',
    'Create a new worker agent and bootstrap it until Claude Code is ready for tasks. Returns only when the agent is fully interactive.',
    {
      name: z.string().describe('Unique name for the agent (lowercase, no spaces)'),
      task: z.string().optional().describe('The task/prompt to give the agent'),
      autonomous: z.boolean().optional().describe('Skip permission prompts (default: true)'),
      api_key: z.string().optional().describe('Override ANTHROPIC_API_KEY for this agent'),
      oauth_token: z.string().optional().describe('Override CLAUDE_CODE_OAUTH_TOKEN for this agent'),
    },
    async (params) => {
      try {
        const result = await api('/agents', {
          method: 'POST',
          body: JSON.stringify(params),
          timeoutMs: 120_000,
        });
        if (result.error) return errorResult(result.error as string);
        return jsonResult({...result, ready: true});
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    'kill_agent',
    'Stop and remove a worker agent (container + tmux session)',
    {name: z.string().describe('Name of the agent to kill')},
    async ({name}) => {
      try {
        const result = await api(`/agents/${encodeURIComponent(name)}`, {
          method: 'DELETE',
          timeoutMs: 20_000,
        });
        if (result.error) return errorResult(result.error as string);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    'send_keys',
    'Send a sequence of keystrokes to an agent\'s terminal via tmux',
    {
      name: z.string().describe('Name of the agent'),
      keys: z.array(
        z.union([
          z.object({text: z.string().describe('Literal text to type (sent with tmux -l flag)')}),
          z.object({key: z.string().describe('Tmux key name: Enter, Down, Up, Escape, Tab, Space, etc.')}),
        ]),
      ).describe('Ordered list of actions to send'),
    },
    async ({name, keys}) => {
      try {
        const result = await api(`/agents/${encodeURIComponent(name)}/keys`, {
          method: 'POST',
          body: JSON.stringify({keys}),
        });
        if (result.error) return errorResult(result.error as string);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    'read_output',
    'Read recent terminal output from an agent\'s Claude Code session',
    {
      name: z.string().describe('Name of the agent'),
      lines: z.number().optional().describe('Number of lines to capture (default: 200)'),
    },
    async ({name, lines}) => {
      try {
        const qs = lines ? `?lines=${lines}` : '';
        const result = await api(`/agents/${encodeURIComponent(name)}/output${qs}`);
        if (result.error) return errorResult(result.error as string);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    'list_agents',
    'List all active worker agents with their status, ports, and tasks',
    {},
    async () => {
      try {
        const result = await api('/projects/_all/agents');
        return jsonResult(result);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    'wait_for_output',
    'Wait until specific text appears in an agent\'s terminal output',
    {
      name: z.string().describe('Name of the agent'),
      text: z.string().describe('Text to wait for'),
      timeout: z.number().optional().describe('Timeout in seconds (default: 30)'),
    },
    async ({name, text, timeout}) => {
      try {
        const result = await api(`/agents/${encodeURIComponent(name)}/wait-output`, {
          method: 'POST',
          body: JSON.stringify({text, timeout: timeout ?? 30}),
          timeoutMs: ((timeout ?? 30) + 5) * 1000,
        });
        if (result.error) return errorResult(result.error as string);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    'wait_for_completion',
    'Block until an agent signals task completion via Stop hook callback',
    {
      name: z.string().describe('Name of the agent'),
      timeout: z.number().optional().describe('Timeout in seconds (default: 300)'),
    },
    async ({name, timeout}) => {
      try {
        const result = await api(`/agents/${encodeURIComponent(name)}/wait-completion`, {
          method: 'POST',
          body: JSON.stringify({timeout: timeout ?? 300}),
          timeoutMs: ((timeout ?? 300) + 5) * 1000,
        });
        if (result.error) return errorResult(result.error as string);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
