import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import type {AgentState, AgentEvent} from '../types.js';
import {CONTAINER_WORKSPACE, agentClaudeMd, AGENT_MCP_JSON, agentSettingsJson, resolveAuth, claudeConfigJson} from '../types.js';
import type {AuthConfig} from '../types.js';
import {pushEvent, waitForAgent} from '../utils/callback.js';
import {allocateVncPort, freeVncPort, reserveVncPort} from '../utils/ports.js';
import {dockerRun, dockerStop, dockerRm, dockerExec, dockerCp, dockerListAbox} from '../utils/docker.js';
import {tmuxNewSession, tmuxSendKeys, tmuxCapture, tmuxKill, tmuxHasSession} from '../utils/tmux.js';
import {jsonResult, errorResult} from '../utils/response.js';

export const agents = new Map<string, AgentState>();

/** Re-hydrate agent state from running abox-* containers on startup */
export function recoverAgents(): number {
  const containers = dockerListAbox();
  for (const c of containers) {
    if (agents.has(c.name)) continue;
    if (c.name === 'agento') continue; // Skip orchestrator container
    agents.set(c.name, {
      name: c.name,
      task: '',
      containerId: c.containerId,
      vncPort: c.vncPort,
      tmuxSession: `abox-${c.name}`,
      status: c.status === 'running' ? 'idle' : 'dead',
      createdAt: c.createdAt,
    });
    if (c.vncPort > 0) reserveVncPort(c.vncPort);
  }
  return containers.length;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Poll until the computer-use MCP server port is listening inside the container. */
async function waitForPort(name: string, port = 8808, timeoutMs = 60000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      dockerExec(name, ['bash', '-c', `timeout 1 bash -c '</dev/tcp/localhost/${port}'`], 'kasm-user');
      return true;
    } catch {
      await sleep(2000);
    }
  }
  return false;
}

/** Poll tmux output until it contains the target text (case-insensitive). */
async function waitForText(name: string, text: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  const lower = text.toLowerCase();
  while (Date.now() - start < timeoutMs) {
    if (!tmuxHasSession(name)) return false;
    const output = tmuxCapture(name);
    if (output.toLowerCase().includes(lower)) return true;
    await sleep(1000);
  }
  return false;
}


export function registerAgents(server: McpServer): void {
  // ── create_agent ──────────────────────────────────────────────────────────
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
    async ({name, task, autonomous, api_key, oauth_token}) => {
      if (agents.has(name)) {
        return errorResult(`Agent "${name}" already exists`);
      }

      const autoMode = autonomous !== false;
      const vncPort = allocateVncPort();
      const tmuxSession = `abox-${name}`;

      const auth: AuthConfig = {
        ...(api_key ? {apiKey: api_key} : {}),
        ...(oauth_token ? {oauthToken: oauth_token} : {}),
      };
      const authEnvs = resolveAuth(Object.keys(auth).length > 0 ? auth : undefined);

      try {
        // 1. Start container
        const containerId = dockerRun(name, vncPort, authEnvs);

        const agent: AgentState = {
          name,
          task: task ?? '',
          containerId,
          vncPort,
          tmuxSession,
          status: 'idle',
          createdAt: Date.now(),
        };
        agents.set(name, agent);

        // 2. Wait for computer-use MCP server port
        const portReady = await waitForPort(name);
        if (!portReady) {
          agent.status = 'dead';
          return errorResult(`Container MCP server did not start within 60s`);
        }

        // 3. Write config files
        dockerExec(name, ['mkdir', '-p', CONTAINER_WORKSPACE]);
        dockerCp(name, agentClaudeMd(name), `${CONTAINER_WORKSPACE}/CLAUDE.md`);
        dockerCp(name, AGENT_MCP_JSON, `${CONTAINER_WORKSPACE}/.mcp.json`);
        dockerCp(name, claudeConfigJson(Object.keys(auth).length > 0 ? auth : undefined), '/home/kasm-user/.claude.json');
        dockerExec(name, ['mkdir', '-p', '/home/kasm-user/.claude'], 'root');
        dockerCp(name, agentSettingsJson(name), '/home/kasm-user/.claude/settings.json');
        dockerExec(name, ['chown', '-R', 'kasm-user:kasm-user', CONTAINER_WORKSPACE], 'root');
        dockerExec(name, ['chown', '-R', 'kasm-user:kasm-user', '/home/kasm-user/.claude'], 'root');
        dockerExec(name, ['chown', 'kasm-user:kasm-user', '/home/kasm-user/.claude.json'], 'root');

        // 4. Launch Claude Code in tmux
        const claudeCmd = autoMode
          ? `cd ${CONTAINER_WORKSPACE} && claude --dangerously-skip-permissions`
          : `cd ${CONTAINER_WORKSPACE} && claude`;
        tmuxNewSession(name, claudeCmd);

        // 5. Wait for bypass prompt and accept it (autonomous mode only)
        if (autoMode) {
          const bypassReady = await waitForText(name, 'bypass', 60000);
          if (!bypassReady) {
            agent.status = 'dead';
            return errorResult(`Claude Code did not show bypass prompt within 60s`);
          }
          tmuxSendKeys(name, 'Down', false);
          tmuxSendKeys(name, 'Enter', false);
        }

        // 6. Wait for interactive prompt
        const promptReady = await waitForText(name, 'Try', 30000);
        if (!promptReady) {
          agent.status = 'dead';
          return errorResult(`Claude Code did not become interactive within 30s`);
        }

        agent.status = 'idle';

        const event: AgentEvent = {
          ts: new Date().toISOString(),
          agent: name,
          state: 'idle',
          msg: '',
        };
        agent.lastEvent = event;
        pushEvent(event);

        return jsonResult({
          ok: true,
          name,
          ready: true,
          status: 'idle',
          vncPort,
          vncUrl: `https://localhost:${vncPort}`,
          containerId: containerId.slice(0, 12),
        });
      } catch (err) {
        agents.delete(name);
        freeVncPort(vncPort);
        dockerRm(name);
        return errorResult(`Failed to create agent: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // ── kill_agent ────────────────────────────────────────────────────────────
  server.tool(
    'kill_agent',
    'Stop and remove a worker agent (container + tmux session)',
    {
      name: z.string().describe('Name of the agent to kill'),
    },
    async ({name}) => {
      const agent = agents.get(name);
      if (!agent) {
        return errorResult(`Agent "${name}" not found`);
      }

      agent.status = 'dead';

      // Kill tmux session inside container
      tmuxKill(name);

      // Stop and remove container (cleans up everything inside)
      dockerStop(name);
      dockerRm(name);

      // Free VNC port
      freeVncPort(agent.vncPort);

      agents.delete(name);

      return jsonResult({ok: true, killed: name});
    },
  );

  // ── send_keys ────────────────────────────────────────────────────────────
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
      const agent = agents.get(name);
      if (!agent) {
        return errorResult(`Agent "${name}" not found`);
      }
      if (!tmuxHasSession(name)) {
        agent.status = 'dead';
        return errorResult(`Agent "${name}" tmux session not found (may have exited)`);
      }

      for (const action of keys) {
        if ('text' in action) {
          tmuxSendKeys(name, action.text, true);
        } else {
          tmuxSendKeys(name, action.key, false);
        }
      }

      // Extract first text action as the task description
      const firstText = keys.find((k): k is {text: string} => 'text' in k);
      const msg = firstText ? firstText.text.slice(0, 100) : '';

      agent.status = 'working';
      const event: AgentEvent = {
        ts: new Date().toISOString(),
        agent: name,
        state: 'working',
        msg,
      };
      agent.lastEvent = event;
      pushEvent(event);

      return jsonResult({ok: true, sent: keys, to: name});
    },
  );

  // ── read_output ───────────────────────────────────────────────────────────
  server.tool(
    'read_output',
    'Read recent terminal output from an agent\'s Claude Code session',
    {
      name: z.string().describe('Name of the agent'),
      lines: z.number().optional().describe('Number of lines to capture (default: 200)'),
    },
    async ({name, lines}) => {
      const agent = agents.get(name);
      if (!agent) {
        return errorResult(`Agent "${name}" not found`);
      }
      if (!tmuxHasSession(name)) {
        agent.status = 'dead';
        return errorResult(`Agent "${name}" tmux session not found`);
      }

      const output = tmuxCapture(name, lines ?? 200);
      return jsonResult({name, output});
    },
  );

  // ── list_agents ───────────────────────────────────────────────────────────
  server.tool(
    'list_agents',
    'List all active worker agents with their status, ports, and tasks',
    {},
    async () => {
      const list = Array.from(agents.values()).map(a => {
        const sessionAlive = tmuxHasSession(a.name);
        if (!sessionAlive && a.status !== 'dead') {
          // Try to capture last output for diagnostic
          let lastLine = 'session lost';
          try {
            const output = tmuxCapture(a.name);
            const lines = output.trim().split('\n').filter(l => l.trim());
            if (lines.length > 0) lastLine = lines[lines.length - 1].slice(0, 100);
          } catch { /* container may be gone */ }

          a.status = 'dead';
          const event: AgentEvent = {
            ts: new Date().toISOString(),
            agent: a.name,
            state: 'dead',
            msg: lastLine,
          };
          a.lastEvent = event;
          pushEvent(event);
        }
        return {
          name: a.name,
          status: a.status,
          task: a.task,
          lastEvent: a.lastEvent?.msg ?? '',
          vncPort: a.vncPort,
          vncUrl: `https://localhost:${a.vncPort}`,
          uptime: Math.round((Date.now() - a.createdAt) / 1000),
        };
      });

      return jsonResult({agents: list, count: list.length});
    },
  );

  // ── wait_for_output ───────────────────────────────────────────────────────
  server.tool(
    'wait_for_output',
    'Wait until specific text appears in an agent\'s terminal output',
    {
      name: z.string().describe('Name of the agent'),
      text: z.string().describe('Text to wait for'),
      timeout: z.number().optional().describe('Timeout in seconds (default: 30)'),
    },
    async ({name, text, timeout}) => {
      const agent = agents.get(name);
      if (!agent) {
        return errorResult(`Agent "${name}" not found`);
      }

      const timeoutMs = (timeout ?? 30) * 1000;
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        if (!tmuxHasSession(name)) {
          agent.status = 'dead';
          return errorResult(`Agent "${name}" tmux session ended while waiting`);
        }

        const output = tmuxCapture(name);
        if (output.includes(text)) {
          return jsonResult({ok: true, found: true, text, elapsed: Math.round((Date.now() - start) / 1000)});
        }

        await sleep(1000);
      }

      return jsonResult({ok: false, found: false, text, timedOut: true});
    },
  );

  // ── wait_for_completion ────────────────────────────────────────────────────
  server.tool(
    'wait_for_completion',
    'Block until an agent signals task completion via Stop hook callback',
    {
      name: z.string().describe('Name of the agent'),
      timeout: z.number().optional().describe('Timeout in seconds (default: 300)'),
    },
    async ({name, timeout}) => {
      const agent = agents.get(name);
      if (!agent) {
        return errorResult(`Agent "${name}" not found`);
      }

      if (agent.status === 'completed') {
        return jsonResult({
          ok: true,
          completed: true,
          agent: name,
          elapsed: agent.completedAt ? Math.round((agent.completedAt - agent.createdAt) / 1000) : 0,
        });
      }

      const timeoutMs = (timeout ?? 300) * 1000;
      const {completed} = await waitForAgent(name, timeoutMs);

      if (completed) {
        return jsonResult({ok: true, completed: true, agent: name});
      }

      return jsonResult({ok: false, completed: false, agent: name, timedOut: true});
    },
  );
}
