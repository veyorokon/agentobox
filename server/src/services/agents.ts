import type {AgentState, AgentEvent, AuthConfig} from '../types.js';
import {CONTAINER_WORKSPACE, agentClaudeMd, AGENT_MCP_JSON, agentSettingsJson, resolveAuth, claudeConfigJson} from '../types.js';
import {agents, pushEvent, persistAgent, deleteAgentFromDb, loadAgentsFromDb} from '../state.js';
import {bus} from '../bus.js';
import {allocateVncPort, freeVncPort, reserveVncPort} from '../utils/ports.js';
import {dockerRun, dockerStop, dockerRm, dockerExec, dockerCp, dockerListAbox} from '../utils/docker.js';
import {tmuxNewSession, tmuxSendKeys, tmuxCapture, tmuxKill, tmuxHasSession} from '../utils/tmux.js';
import {withSpan} from '../telemetry.js';
import {agentLog} from '../logger.js';

export type KeyAction = {text: string} | {key: string};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Emit agent_update for a project via the bus. */
function emitAgentUpdate(projectId?: string) {
  if (!projectId) return;
  const list = Array.from(agents.values())
    .filter(a => a.projectId === projectId)
    .map(a => ({
      name: a.name, status: a.status, task: a.task,
      currentTask: a.currentTask ?? '', lastEvent: a.lastEvent?.msg ?? '',
      vncPort: a.vncPort, vncUrl: `http://localhost:${a.vncPort}`,
      uptime: Math.round((Date.now() - a.createdAt) / 1000),
    }));
  bus.emitAgentUpdate(projectId, list);
}

/** Poll until the computer-use MCP server port is listening inside the container. */
async function waitForPort(name: string, port = 8808, timeoutMs = 60000): Promise<boolean> {
  return withSpan('agent.wait_port', {'agent.name': name, 'agent.port': port, 'agent.timeout_ms': timeoutMs}, async (span) => {
    const start = Date.now();
    let attempts = 0;
    while (Date.now() - start < timeoutMs) {
      attempts++;
      try {
        await dockerExec(name, ['bash', '-c', `timeout 1 bash -c '</dev/tcp/localhost/${port}'`], 'kasm-user');
        span.setAttribute('agent.attempts', attempts);
        span.setAttribute('agent.elapsed_ms', Date.now() - start);
        return true;
      } catch {
        await sleep(1000);
      }
    }
    span.setAttribute('agent.attempts', attempts);
    span.setAttribute('agent.elapsed_ms', Date.now() - start);
    span.setAttribute('agent.timed_out', true);
    return false;
  });
}

/** Poll tmux output until it contains the target text (case-insensitive). */
async function waitForText(name: string, text: string, timeoutMs: number): Promise<boolean> {
  return withSpan('agent.wait_text', {'agent.name': name, 'agent.target_text': text, 'agent.timeout_ms': timeoutMs}, async (span) => {
    const start = Date.now();
    const lower = text.toLowerCase();
    let attempts = 0;
    while (Date.now() - start < timeoutMs) {
      attempts++;
      if (!(await tmuxHasSession(name))) {
        span.setAttribute('agent.attempts', attempts);
        span.setAttribute('agent.session_lost', true);
        return false;
      }
      const output = await tmuxCapture(name);
      if (output.toLowerCase().includes(lower)) {
        span.setAttribute('agent.attempts', attempts);
        span.setAttribute('agent.elapsed_ms', Date.now() - start);
        return true;
      }
      await sleep(1000);
    }
    span.setAttribute('agent.attempts', attempts);
    span.setAttribute('agent.elapsed_ms', Date.now() - start);
    span.setAttribute('agent.timed_out', true);
    return false;
  });
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

  return withSpan('agent.create', {'agent.name': name, 'agent.autonomous': autonomous !== false}, async (span) => {
    if (agents.has(name)) {
      throw new Error(`Agent "${name}" already exists`);
    }

    const autoMode = autonomous !== false;
    const vncPort = allocateVncPort();
    span.setAttribute('agent.vnc_port', vncPort);

    const auth: AuthConfig = {
      ...(api_key ? {apiKey: api_key} : {}),
      ...(oauth_token ? {oauthToken: oauth_token} : {}),
    };
    const authEnvs = resolveAuth(Object.keys(auth).length > 0 ? auth : undefined);

    try {
      agentLog.info({agent: name, phase: 'docker.run', vncPort}, 'creating container');
      const containerId = await dockerRun(name, vncPort, authEnvs);
      span.setAttribute('agent.container_id', containerId.slice(0, 12));
      agentLog.info({agent: name, phase: 'docker.run', containerId: containerId.slice(0, 12)}, 'container started');

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

      agentLog.info({agent: name, phase: 'wait_port'}, 'waiting for MCP server port');
      const portReady = await waitForPort(name);
      if (!portReady) {
        agent.status = 'dead';
        throw new Error('Container MCP server did not start within 60s');
      }
      agentLog.info({agent: name, phase: 'wait_port'}, 'MCP server port ready');

      // Provision phase
      agentLog.info({agent: name, phase: 'provision'}, 'provisioning workspace');
      await withSpan('agent.provision', {'agent.name': name}, async () => {
        await dockerExec(name, ['mkdir', '-p', CONTAINER_WORKSPACE]);
        await dockerCp(name, agentClaudeMd(name), `${CONTAINER_WORKSPACE}/CLAUDE.md`);
        await dockerCp(name, AGENT_MCP_JSON, `${CONTAINER_WORKSPACE}/.mcp.json`);
        await dockerCp(name, claudeConfigJson(Object.keys(auth).length > 0 ? auth : undefined), '/home/kasm-user/.claude.json');
        await dockerExec(name, ['mkdir', '-p', '/home/kasm-user/.claude'], 'root');
        await dockerCp(name, agentSettingsJson(name), '/home/kasm-user/.claude/settings.json');
        await dockerExec(name, ['chown', '-R', 'kasm-user:kasm-user', CONTAINER_WORKSPACE], 'root');
        await dockerExec(name, ['chown', '-R', 'kasm-user:kasm-user', '/home/kasm-user/.claude'], 'root');
        await dockerExec(name, ['chown', 'kasm-user:kasm-user', '/home/kasm-user/.claude.json'], 'root');
      });
      agentLog.info({agent: name, phase: 'provision'}, 'workspace provisioned');

      const claudeCmd = autoMode
        ? `cd ${CONTAINER_WORKSPACE} && claude --dangerously-skip-permissions`
        : `cd ${CONTAINER_WORKSPACE} && claude`;
      await tmuxNewSession(name, claudeCmd);
      agentLog.info({agent: name, phase: 'claude_start', autonomous: autoMode}, 'claude code launched');

      if (autoMode) {
        agentLog.info({agent: name, phase: 'wait_bypass'}, 'waiting for bypass prompt');
        const bypassReady = await waitForText(name, 'bypass', 60000);
        if (!bypassReady) {
          agent.status = 'dead';
          throw new Error('Claude Code did not show bypass prompt within 60s');
        }
        await tmuxSendKeys(name, 'Down', false);
        await tmuxSendKeys(name, 'Enter', false);
        agentLog.info({agent: name, phase: 'wait_bypass'}, 'bypass prompt accepted');
      }

      agentLog.info({agent: name, phase: 'wait_prompt'}, 'waiting for interactive prompt');
      const promptReady = await waitForText(name, 'Try', 30000);
      if (!promptReady) {
        agent.status = 'dead';
        throw new Error('Claude Code did not become interactive within 30s');
      }

      agent.status = 'idle';
      const event: AgentEvent = {ts: new Date().toISOString(), agent: name, state: 'idle', msg: ''};
      agent.lastEvent = event;
      pushEvent(event);
      persistAgent(agent);
      emitAgentUpdate(projectId);
      agentLog.info({agent: name, phase: 'ready', vncPort}, 'agent ready');

      return {ok: true, name, status: 'idle', vncPort, vncUrl: `http://localhost:${vncPort}`, containerId: containerId.slice(0, 12)};
    } catch (err) {
      agentLog.error({agent: name, err}, 'agent creation failed');
      agents.delete(name);
      deleteAgentFromDb(name);
      freeVncPort(vncPort);
      await dockerRm(name);
      throw err;
    }
  });
}

export async function killAgentCore(name: string): Promise<{ok: true; killed: string}> {
  return withSpan('agent.kill', {'agent.name': name}, async () => {
    const agent = agents.get(name);
    if (!agent) throw new Error(`Agent "${name}" not found`);

    const projectId = agent.projectId;
    agent.status = 'dead';
    await tmuxKill(name);
    await dockerStop(name);
    await dockerRm(name);
    freeVncPort(agent.vncPort);
    agents.delete(name);
    deleteAgentFromDb(name);
    emitAgentUpdate(projectId);

    return {ok: true, killed: name};
  });
}

export async function sendKeysCore(name: string, keys: KeyAction[]): Promise<{ok: true; sent: KeyAction[]; to: string}> {
  return withSpan('agent.send_keys', {'agent.name': name, 'agent.key_count': keys.length}, async () => {
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
    persistAgent(agent);
    emitAgentUpdate(agent.projectId);

    return {ok: true, sent: keys, to: name};
  });
}

export async function readOutputCore(name: string, lines = 200): Promise<{name: string; output: string}> {
  return withSpan('agent.read_output', {'agent.name': name, 'agent.lines': lines}, async () => {
    const agent = agents.get(name);
    if (!agent) throw new Error(`Agent "${name}" not found`);
    if (!(await tmuxHasSession(name))) {
      agent.status = 'dead';
      throw new Error(`Agent "${name}" tmux session not found`);
    }

    const output = await tmuxCapture(name, lines);
    return {name, output};
  });
}

export async function listAgentsCore(projectId?: string): Promise<{agents: Array<Record<string, unknown>>; count: number}> {
  return withSpan('agent.list', {'agent.project_id': projectId ?? ''}, async (span) => {
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
        persistAgent(a);
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

    span.setAttribute('agent.count', list.length);
    return {agents: list, count: list.length};
  });
}

/** Re-hydrate agent state from SQLite + running containers on startup. */
export async function recoverAgents(): Promise<number> {
  return withSpan('agent.recover', {}, async (span) => {
    // 1. Load persisted agents from SQLite into the in-memory Map
    const fromDb = loadAgentsFromDb();

    // 2. Discover running containers and merge
    const containers = await dockerListAbox();
    const runningNames = new Set<string>();
    for (const c of containers) {
      runningNames.add(c.name);
      if (agents.has(c.name)) {
        // DB agent exists, update containerId if container was recreated
        const agent = agents.get(c.name)!;
        agent.containerId = c.containerId;
        if (c.vncPort > 0) {
          agent.vncPort = c.vncPort;
          reserveVncPort(c.vncPort);
        }
        if (agent.status === 'dead' && c.status === 'running') {
          agent.status = 'idle';
        }
        persistAgent(agent);
      } else if (c.name !== 'agento') {
        // New container not in DB
        const agent: AgentState = {
          name: c.name,
          task: '',
          containerId: c.containerId,
          vncPort: c.vncPort,
          tmuxSession: `abox-${c.name}`,
          status: c.status === 'running' ? 'idle' : 'dead',
          createdAt: c.createdAt,
        };
        agents.set(c.name, agent);
        persistAgent(agent);
        if (c.vncPort > 0) reserveVncPort(c.vncPort);
      }
    }

    // 3. Mark DB agents as dead if their container is gone
    for (const [name, agent] of agents) {
      if (!runningNames.has(name) && agent.status !== 'dead') {
        agent.status = 'dead';
        persistAgent(agent);
      }
      // Reserve VNC ports for all live agents
      if (agent.status !== 'dead' && agent.vncPort > 0) {
        reserveVncPort(agent.vncPort);
      }
    }

    span.setAttribute('agent.recovered_count', agents.size);
    span.setAttribute('agent.db_count', fromDb);
    span.setAttribute('agent.container_count', containers.length);
    return agents.size;
  });
}

/** Wait for specific text to appear in an agent's terminal output. */
export async function waitForOutputCore(name: string, text: string, timeoutMs: number, signal?: AbortSignal): Promise<{found: boolean; elapsed: number}> {
  return withSpan('agent.wait_output', {'agent.name': name, 'agent.target_text': text, 'agent.timeout_ms': timeoutMs}, async (span) => {
    const agent = agents.get(name);
    if (!agent) throw new Error(`Agent "${name}" not found`);

    const start = Date.now();
    let attempts = 0;

    while (Date.now() - start < timeoutMs) {
      attempts++;
      if (signal?.aborted) {
        span.setAttribute('agent.attempts', attempts);
        span.setAttribute('agent.aborted', true);
        return {found: false, elapsed: Math.round((Date.now() - start) / 1000)};
      }
      if (!(await tmuxHasSession(name))) {
        agent.status = 'dead';
        throw new Error(`Agent "${name}" tmux session ended while waiting`);
      }
      const output = await tmuxCapture(name);
      if (output.includes(text)) {
        span.setAttribute('agent.attempts', attempts);
        span.setAttribute('agent.elapsed_ms', Date.now() - start);
        return {found: true, elapsed: Math.round((Date.now() - start) / 1000)};
      }
      await sleep(1000);
    }

    span.setAttribute('agent.attempts', attempts);
    span.setAttribute('agent.elapsed_ms', Date.now() - start);
    span.setAttribute('agent.timed_out', true);
    return {found: false, elapsed: Math.round((Date.now() - start) / 1000)};
  });
}
