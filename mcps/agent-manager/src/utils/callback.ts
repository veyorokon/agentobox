import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {CALLBACK_PORT, EVENT_TAG} from '../types.js';
import type {AgentEvent, AgentStatus} from '../types.js';
import {agents} from '../tools/agents.js';
import {localTmuxSendKeys, tmuxSendKeys, tmuxHasSession} from './tmux.js';
import {sendMessage} from './agento.js';
import {randomBytes} from 'node:crypto';

const VALID_STATES: AgentStatus[] = ['idle', 'working', 'completed', 'blocked', 'dead'];
const AGENTO_SESSION = 'agento';
const MAX_EVENTS_PER_AGENT = 50;

// ── Route parsing ──────────────────────────────────────────────────────────

function parseRoute(url: string): {projectId?: string; path: string; query: string} {
  const [pathPart, query = ''] = (url ?? '/').split('?');
  const match = pathPart.match(/^\/projects\/([^/]+)(\/.*)?$/);
  if (match) return {projectId: match[1], path: match[2] || '/', query};
  return {path: pathPart, query};
}

// ── Injection config ────────────────────────────────────────────────────────

/** States that get injected into Agento's tmux session */
const IMMEDIATE_STATES: AgentStatus[] = ['blocked', 'dead'];
const INJECTABLE_STATES: AgentStatus[] = ['blocked', 'dead', 'completed'];

/** Batching: flush after this many ms or this many events, whichever comes first */
const BATCH_WINDOW_MS = 5_000;
const BATCH_MAX_SIZE = 10;

// ── Event injection ─────────────────────────────────────────────────────────

const eventBuffer: AgentEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function formatEvent(event: AgentEvent): string {
  const msg = event.msg ? `: ${event.msg}` : '';
  return `@abox:e:${EVENT_TAG} [${event.agent}] ${event.state}${msg}`;
}

/** Inject one or more events into Agento's local tmux session as a user message. */
function injectIntoAgento(events: AgentEvent[]): void {
  if (events.length === 0) return;
  const text = events.map(formatEvent).join('\n');
  try {
    localTmuxSendKeys(AGENTO_SESSION, text, true);
    localTmuxSendKeys(AGENTO_SESSION, 'Enter', false);
    console.error(`[inject] Sent ${events.length} event(s) to Agento`);
  } catch (err) {
    console.error(`[inject] Failed to inject into Agento: ${err instanceof Error ? err.message : err}`);
  }
}

function flushBuffer(): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (eventBuffer.length === 0) return;

  // Dedupe: keep only the latest event per agent
  const latest = new Map<string, AgentEvent>();
  for (const e of eventBuffer) latest.set(e.agent, e);

  injectIntoAgento([...latest.values()]);
  eventBuffer.length = 0;
}

function queueForInjection(event: AgentEvent): void {
  if (!INJECTABLE_STATES.includes(event.state)) return;

  // Immediate: flush pending buffer first, then inject right away
  if (IMMEDIATE_STATES.includes(event.state)) {
    flushBuffer();
    injectIntoAgento([event]);
    return;
  }

  // Batched: accumulate and flush on timer or count
  eventBuffer.push(event);
  if (eventBuffer.length >= BATCH_MAX_SIZE) {
    flushBuffer();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(flushBuffer, BATCH_WINDOW_MS);
  }
}

// ── In-memory event store ───────────────────────────────────────────────────

const eventStore = new Map<string, AgentEvent[]>();

export function getEvents(agentName?: string): AgentEvent[] {
  if (agentName) return eventStore.get(agentName) ?? [];
  const all: AgentEvent[] = [];
  for (const events of eventStore.values()) all.push(...events);
  all.sort((a, b) => a.ts.localeCompare(b.ts));
  return all;
}

/** Get events filtered to agents belonging to a specific project */
function getEventsForProject(projectId: string): AgentEvent[] {
  const projectAgentNames = new Set<string>();
  for (const a of agents.values()) {
    if (a.projectId === projectId) projectAgentNames.add(a.name);
  }
  const all: AgentEvent[] = [];
  for (const [agentName, events] of eventStore) {
    if (projectAgentNames.has(agentName)) all.push(...events);
  }
  all.sort((a, b) => a.ts.localeCompare(b.ts));
  return all;
}

export function pushEvent(event: AgentEvent): void {
  if (!eventStore.has(event.agent)) eventStore.set(event.agent, []);
  const list = eventStore.get(event.agent)!;
  list.push(event);
  if (list.length > MAX_EVENTS_PER_AGENT) list.shift();
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/** Listeners waiting for a specific agent to complete */
const waiters = new Map<string, Array<(result?: string) => void>>();

export function waitForAgent(name: string, timeoutMs: number): Promise<{completed: boolean; result?: string}> {
  const agent = agents.get(name);
  if (agent && agent.status === 'completed') {
    return Promise.resolve({completed: true});
  }

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      const list = waiters.get(name);
      if (list) {
        const idx = list.indexOf(cb);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) waiters.delete(name);
      }
      resolve({completed: false});
    }, timeoutMs);

    const cb = (result?: string) => {
      clearTimeout(timer);
      resolve({completed: true, result});
    };

    if (!waiters.has(name)) waiters.set(name, []);
    waiters.get(name)!.push(cb);
  });
}

function notifyWaiters(name: string, result?: string): void {
  const list = waiters.get(name);
  if (list) {
    for (const cb of list) cb(result);
    waiters.delete(name);
  }
}

// ── In-memory chat store ────────────────────────────────────────────────────

interface ChatMsg {
  id: string;
  role: 'user' | 'agento';
  content: string;
  ts: string;
  target?: string;
}

const chatStore = new Map<string, ChatMsg[]>();
const MAX_CHAT_PER_PROJECT = 200;

function genChatId(): string {
  return `msg-${Date.now()}-${randomBytes(3).toString('hex')}`;
}

function pushChat(projectId: string, msg: ChatMsg): void {
  if (!chatStore.has(projectId)) chatStore.set(projectId, []);
  const list = chatStore.get(projectId)!;
  list.push(msg);
  if (list.length > MAX_CHAT_PER_PROJECT) list.shift();
}

function getChat(projectId: string, since?: string): ChatMsg[] {
  const list = chatStore.get(projectId) ?? [];
  if (!since) return list;
  return list.filter(m => m.ts > since);
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function serializeAgentList(projectId?: string) {
  let values = Array.from(agents.values());
  if (projectId) values = values.filter(a => a.projectId === projectId);
  return values.map(a => ({
    name: a.name,
    status: a.status,
    task: a.task,
    currentTask: a.currentTask ?? '',
    lastEvent: a.lastEvent?.msg ?? '',
    vncPort: a.vncPort,
    vncUrl: `http://localhost:${a.vncPort}`,
    uptime: Math.round((Date.now() - a.createdAt) / 1000),
  }));
}

function handleEvent(data: {agent?: string; state?: string; msg?: string; task?: string}, projectId?: string): {status: number; body: string} {
  const name = data.agent;
  if (!name) return {status: 400, body: '{"error":"missing agent name"}'};

  const state = data.state as AgentStatus;
  if (!state || !VALID_STATES.includes(state)) {
    return {status: 400, body: `{"error":"invalid state, must be one of: ${VALID_STATES.join(', ')}"}`};
  }

  const event: AgentEvent = {
    ts: new Date().toISOString(),
    agent: name,
    state,
    msg: (data.msg ?? '').slice(0, 100),
  };

  pushEvent(event);

  // Update agent state if tracked
  const agent = agents.get(name);
  if (agent) {
    agent.status = state;
    agent.lastEvent = event;
    if (projectId && !agent.projectId) agent.projectId = projectId;
    if (data.task) agent.currentTask = data.task.slice(0, 100);
    if (state === 'completed') agent.completedAt = Date.now();
    console.error(`[event] ${name}: ${state}${data.task ? ` [${data.task}]` : ''}${event.msg ? ` — ${event.msg}` : ''}`);
  }

  if (state === 'completed') notifyWaiters(name);

  // Queue for injection into Agento's tmux (batched or immediate)
  if (agent && name !== AGENTO_SESSION) queueForInjection(event);

  return {status: 200, body: '{"ok":true}'};
}

// ── Request handler ─────────────────────────────────────────────────────────

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const {projectId, path} = parseRoute(req.url ?? '/');

  // ── GET /agents or /projects/:id/agents ─────────────────────────────────
  if (req.method === 'GET' && (path === '/agents' || req.url === '/agents')) {
    const list = serializeAgentList(projectId);
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({agents: list, count: list.length}));
    return;
  }

  // ── POST /event or /projects/:id/event ──────────────────────────────────
  if (req.method === 'POST' && (path === '/event' || req.url === '/event')) {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      const result = handleEvent(data, projectId);
      res.writeHead(result.status);
      res.end(result.body);
    } catch {
      res.writeHead(400);
      res.end('{"error":"invalid request"}');
    }
    return;
  }

  // ── GET /events or /projects/:id/events ─────────────────────────────────
  if (req.method === 'GET' && (path?.startsWith('/events') || req.url?.startsWith('/events'))) {
    const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`);
    const agentName = url.searchParams.get('agent') ?? undefined;

    let events: AgentEvent[];
    if (projectId) {
      events = getEventsForProject(projectId);
      if (agentName) events = events.filter(e => e.agent === agentName);
    } else {
      events = getEvents(agentName);
    }

    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({events, count: events.length}));
    return;
  }

  // ── POST /projects/:id/chat ───────────────────────────────────────────────
  if (req.method === 'POST' && projectId && path === '/chat') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body) as {target?: string; content?: string};
      const content = data.content?.trim();
      if (!content) {
        res.writeHead(400);
        res.end('{"error":"missing content"}');
        return;
      }

      const target = data.target || 'agento';
      const userMsg: ChatMsg = {id: genChatId(), role: 'user', content, ts: new Date().toISOString(), target};
      pushChat(projectId, userMsg);

      if (target === 'agento') {
        try {
          const replyText = await sendMessage(projectId, content);
          const reply: ChatMsg = {id: genChatId(), role: 'agento', content: replyText, ts: new Date().toISOString()};
          pushChat(projectId, reply);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[agento] LLM error: ${errMsg}`);
          const reply: ChatMsg = {id: genChatId(), role: 'agento', content: `Error: ${errMsg}`, ts: new Date().toISOString()};
          pushChat(projectId, reply);
        }
      } else {
        // Direct agent messaging via tmux
        const agent = agents.get(target);
        if (!agent) {
          const reply: ChatMsg = {id: genChatId(), role: 'agento', content: `Agent "${target}" not found.`, ts: new Date().toISOString()};
          pushChat(projectId, reply);
        } else if (!tmuxHasSession(target)) {
          const reply: ChatMsg = {id: genChatId(), role: 'agento', content: `Agent "${target}" session is not active.`, ts: new Date().toISOString()};
          pushChat(projectId, reply);
        } else {
          tmuxSendKeys(target, content, true);
          tmuxSendKeys(target, 'Enter', false);
          const reply: ChatMsg = {id: genChatId(), role: 'agento', content: `Sent to ${target}.`, ts: new Date().toISOString()};
          pushChat(projectId, reply);
        }
      }

      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end('{"ok":true}');
    } catch {
      res.writeHead(400);
      res.end('{"error":"invalid request"}');
    }
    return;
  }

  // ── GET /projects/:id/chat ──────────────────────────────────────────────
  if (req.method === 'GET' && projectId && path?.startsWith('/chat')) {
    const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`);
    const since = url.searchParams.get('since') ?? undefined;
    const messages = getChat(projectId, since);
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({messages, count: messages.length}));
    return;
  }

  res.writeHead(404);
  res.end('{"error":"not found"}');
}

export function startCallbackServer(): void {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      res.writeHead(500);
      res.end('{"error":"internal"}');
    });
  });

  server.listen(CALLBACK_PORT, () => {
    console.error(`Callback server listening on port ${CALLBACK_PORT} (event tag: ${EVENT_TAG})`);
  });
}
