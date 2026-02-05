import type {AgentState, AgentEvent, AuthConfig} from '../types.js';
import {CONTAINER_WORKSPACE, agentClaudeMd, AGENT_MCP_JSON, agentSettingsJson, resolveAuth, claudeConfigJson} from '../types.js';
import {agents, pushEvent} from '../state.js';
import {allocateVncPort, freeVncPort, reserveVncPort} from '../utils/ports.js';
import {dockerRun, dockerStop, dockerRm, dockerExec, dockerCp, dockerListAbox} from '../utils/docker.js';
import {tmuxNewSession, tmuxSendKeys, tmuxCapture, tmuxKill, tmuxHasSession} from '../utils/tmux.js';

export type KeyAction = {text: string} | {key: string};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Poll until the computer-use MCP server port is listening inside the container. */
async function waitForPort(name: string, port = 8808, timeoutMs = 60000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await dockerExec(name, ['bash', '-c', `timeout 1 bash -c '</dev/tcp/localhost/${port}'`], 'kasm-user');
      return true;
    } catch {
      await sleep(1000);
    }
  }
  return false;
}

/** Poll tmux output until it contains the target text (case-insensitive). */
async function waitForText(name: string, text: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  const lower = text.toLowerCase();
  while (Date.now() - start < timeoutMs) {
    if (!(await tmuxHasSession(name))) return false;
    const output = await tmuxCapture(name);
    if (output.toLowerCase().includes(lower)) return true;
    await sleep(1000);
  }
  return false;
}

// ── Core functions ───────────────────────────────────────────────────────────

export async function createAgentCore(params: {
  name: string;
  task?: string;
  projectId?: string;
  autonomous?: boolean;
  api_key?: string;
  oauth_token?: string;
}): Promise<{ok: true; name: string; status: string; vncPort: number; vncUrl: string; containerId: string}> {
  const {name, task, projectId, autonomous, api_key, oauth_token} = params;

  if (agents.has(name)) {
    throw new Error(`Agent "${name}" already exists`);
  }

  const autoMode = autonomous !== false;
  const vncPort = allocateVncPort();

  const auth: AuthConfig = {
    ...(api_key ? {apiKey: api_key} : {}),
    ...(oauth_token ? {oauthToken: oauth_token} : {}),
  };
  const authEnvs = resolveAuth(Object.keys(auth).length > 0 ? auth : undefined);

  try {
    const containerId = await dockerRun(name, vncPort, authEnvs);

    const agent: AgentState = {
      name,
      task: task ?? '',
      containerId,
      vncPort,
      tmuxSession: `abox-${name}`,
      status: 'idle',
      projectId,
      createdAt: Date.now(),
    };
    agents.set(name, agent);

    const portReady = await waitForPort(name);
    if (!portReady) {
      agent.status = 'dead';
      throw new Error('Container MCP server did not start within 60s');
    }

    await dockerExec(name, ['mkdir', '-p', CONTAINER_WORKSPACE]);
    await dockerCp(name, agentClaudeMd(name), `${CONTAINER_WORKSPACE}/CLAUDE.md`);
    await dockerCp(name, AGENT_MCP_JSON, `${CONTAINER_WORKSPACE}/.mcp.json`);
    await dockerCp(name, claudeConfigJson(Object.keys(auth).length > 0 ? auth : undefined), '/home/kasm-user/.claude.json');
    await dockerExec(name, ['mkdir', '-p', '/home/kasm-user/.claude'], 'root');
    await dockerCp(name, agentSettingsJson(name), '/home/kasm-user/.claude/settings.json');
    await dockerExec(name, ['chown', '-R', 'kasm-user:kasm-user', CONTAINER_WORKSPACE], 'root');
    await dockerExec(name, ['chown', '-R', 'kasm-user:kasm-user', '/home/kasm-user/.claude'], 'root');
    await dockerExec(name, ['chown', 'kasm-user:kasm-user', '/home/kasm-user/.claude.json'], 'root');

    const claudeCmd = autoMode
      ? `cd ${CONTAINER_WORKSPACE} && claude --dangerously-skip-permissions`
      : `cd ${CONTAINER_WORKSPACE} && claude`;
    await tmuxNewSession(name, claudeCmd);

    if (autoMode) {
      const bypassReady = await waitForText(name, 'bypass', 60000);
      if (!bypassReady) {
        agent.status = 'dead';
        throw new Error('Claude Code did not show bypass prompt within 60s');
      }
      await tmuxSendKeys(name, 'Down', false);
      await tmuxSendKeys(name, 'Enter', false);
    }

    const promptReady = await waitForText(name, 'Try', 30000);
    if (!promptReady) {
      agent.status = 'dead';
      throw new Error('Claude Code did not become interactive within 30s');
    }

    agent.status = 'idle';
    const event: AgentEvent = {ts: new Date().toISOString(), agent: name, state: 'idle', msg: ''};
    agent.lastEvent = event;
    pushEvent(event);

    return {ok: true, name, status: 'idle', vncPort, vncUrl: `http://localhost:${vncPort}`, containerId: containerId.slice(0, 12)};
  } catch (err) {
    agents.delete(name);
    freeVncPort(vncPort);
    await dockerRm(name);
    throw err;
  }
}

export async function killAgentCore(name: string): Promise<{ok: true; killed: string}> {
  const agent = agents.get(name);
  if (!agent) throw new Error(`Agent "${name}" not found`);

  agent.status = 'dead';
  await tmuxKill(name);
  await dockerStop(name);
  await dockerRm(name);
  freeVncPort(agent.vncPort);
  agents.delete(name);

  return {ok: true, killed: name};
}

export async function sendKeysCore(name: string, keys: KeyAction[]): Promise<{ok: true; sent: KeyAction[]; to: string}> {
  const agent = agents.get(name);
  if (!agent) throw new Error(`Agent "${name}" not found`);
  if (!(await tmuxHasSession(name))) {
    agent.status = 'dead';
    throw new Error(`Agent "${name}" tmux session not found (may have exited)`);
  }

  for (const action of keys) {
    if ('text' in action) {
      await tmuxSendKeys(name, action.text, true);
    } else {
      await tmuxSendKeys(name, action.key, false);
    }
  }

  const firstText = keys.find((k): k is {text: string} => 'text' in k);
  const msg = firstText ? firstText.text.slice(0, 100) : '';

  agent.status = 'working';
  const event: AgentEvent = {ts: new Date().toISOString(), agent: name, state: 'working', msg};
  agent.lastEvent = event;
  pushEvent(event);

  return {ok: true, sent: keys, to: name};
}

export async function readOutputCore(name: string, lines = 200): Promise<{name: string; output: string}> {
  const agent = agents.get(name);
  if (!agent) throw new Error(`Agent "${name}" not found`);
  if (!(await tmuxHasSession(name))) {
    agent.status = 'dead';
    throw new Error(`Agent "${name}" tmux session not found`);
  }

  const output = await tmuxCapture(name, lines);
  return {name, output};
}

export async function listAgentsCore(projectId?: string): Promise<{agents: Array<Record<string, unknown>>; count: number}> {
  let values = Array.from(agents.values());
  if (projectId) values = values.filter(a => a.projectId === projectId);

  const list: Array<Record<string, unknown>> = [];
  for (const a of values) {
    const sessionAlive = await tmuxHasSession(a.name);
    if (!sessionAlive && a.status !== 'dead') {
      let lastLine = 'session lost';
      try {
        const output = await tmuxCapture(a.name);
        const lines = output.trim().split('\n').filter(l => l.trim());
        if (lines.length > 0) lastLine = lines[lines.length - 1].slice(0, 100);
      } catch { /* container may be gone */ }

      a.status = 'dead';
      const event: AgentEvent = {ts: new Date().toISOString(), agent: a.name, state: 'dead', msg: lastLine};
      a.lastEvent = event;
      pushEvent(event);
    }
    list.push({
      name: a.name,
      status: a.status,
      task: a.task,
      currentTask: a.currentTask ?? '',
      lastEvent: a.lastEvent?.msg ?? '',
      vncPort: a.vncPort,
      vncUrl: `http://localhost:${a.vncPort}`,
      uptime: Math.round((Date.now() - a.createdAt) / 1000),
    });
  }

  return {agents: list, count: list.length};
}

/** Re-hydrate agent state from running abox-* containers on startup */
export async function recoverAgents(): Promise<number> {
  const containers = await dockerListAbox();
  for (const c of containers) {
    if (agents.has(c.name)) continue;
    if (c.name === 'agento') continue;
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

/** Wait for specific text to appear in an agent's terminal output. */
export async function waitForOutputCore(name: string, text: string, timeoutMs: number, signal?: AbortSignal): Promise<{found: boolean; elapsed: number}> {
  const agent = agents.get(name);
  if (!agent) throw new Error(`Agent "${name}" not found`);

  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) return {found: false, elapsed: Math.round((Date.now() - start) / 1000)};
    if (!(await tmuxHasSession(name))) {
      agent.status = 'dead';
      throw new Error(`Agent "${name}" tmux session ended while waiting`);
    }
    const output = await tmuxCapture(name);
    if (output.includes(text)) {
      return {found: true, elapsed: Math.round((Date.now() - start) / 1000)};
    }
    await sleep(1000);
  }

  return {found: false, elapsed: Math.round((Date.now() - start) / 1000)};
}
