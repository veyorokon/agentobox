import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {CALLBACK_PORT, EVENT_TAG} from '../types.js';
import type {AgentEvent, AgentStatus} from '../types.js';
import {agents} from '../tools/agents.js';
import {localTmuxSendKeys} from './tmux.js';

const VALID_STATES: AgentStatus[] = ['idle', 'working', 'completed', 'blocked', 'dead'];
const AGENTO_SESSION = 'agento';
const MAX_EVENTS_PER_AGENT = 50;

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

// ── Request handler ─────────────────────────────────────────────────────────

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(res);

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /agents — live agent state for dashboard polling
  if (req.method === 'GET' && req.url === '/agents') {
    const list = Array.from(agents.values()).map(a => ({
      name: a.name,
      status: a.status,
      task: a.task,
      currentTask: a.currentTask ?? '',
      lastEvent: a.lastEvent?.msg ?? '',
      vncPort: a.vncPort,
      vncUrl: `http://localhost:${a.vncPort}`,
      uptime: Math.round((Date.now() - a.createdAt) / 1000),
    }));
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({agents: list, count: list.length}));
    return;
  }

  // POST /event — unified event ingestion
  if (req.method === 'POST' && req.url === '/event') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body) as {agent?: string; state?: string; msg?: string; task?: string};
      const name = data.agent;

      if (!name) {
        res.writeHead(400);
        res.end('{"error":"missing agent name"}');
        return;
      }

      const state = data.state as AgentStatus;
      if (!state || !VALID_STATES.includes(state)) {
        res.writeHead(400);
        res.end(`{"error":"invalid state, must be one of: ${VALID_STATES.join(', ')}"}`);
        return;
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
        if (data.task) {
          agent.currentTask = data.task.slice(0, 100);
        }
        if (state === 'completed') {
          agent.completedAt = Date.now();
        }
        console.error(`[event] ${name}: ${state}${data.task ? ` [${data.task}]` : ''}${event.msg ? ` — ${event.msg}` : ''}`);
      }

      // Fire waiters on completion
      if (state === 'completed') {
        notifyWaiters(name);
      }

      // Queue for injection into Agento's tmux (batched or immediate)
      // Skip agento's own events — don't inject back into itself
      if (agent && name !== AGENTO_SESSION) {
        queueForInjection(event);
      }

      res.writeHead(200);
      res.end('{"ok":true}');
    } catch {
      res.writeHead(400);
      res.end('{"error":"invalid request"}');
    }
    return;
  }

  // GET /events?agent=X — read events
  if (req.method === 'GET' && req.url?.startsWith('/events')) {
    const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
    const agentName = url.searchParams.get('agent') ?? undefined;
    const events = getEvents(agentName);
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({events, count: events.length}));
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
