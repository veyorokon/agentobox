import {randomBytes} from 'node:crypto';
import {eq, desc, gt} from 'drizzle-orm';
import {db} from './db/index.js';
import * as schema from './db/schema.js';
import type {AgentState, AgentEvent, ChatMsg} from './types.js';

// ── Agent state (in-memory, write-through to DB) ────────────────────────────

export const agents = new Map<string, AgentState>();

/** Persist current agent state to SQLite. */
export function persistAgent(agent: AgentState): void {
  db.insert(schema.agents).values({
    name: agent.name,
    task: agent.task,
    containerId: agent.containerId,
    vncPort: agent.vncPort,
    tmuxSession: agent.tmuxSession,
    status: agent.status,
    projectId: agent.projectId ?? null,
    currentTask: agent.currentTask ?? null,
    createdAt: agent.createdAt,
    completedAt: agent.completedAt ?? null,
    lastEventTs: agent.lastEvent?.ts ?? null,
    lastEventMsg: agent.lastEvent?.msg ?? null,
    lastEventState: agent.lastEvent?.state ?? null,
  }).onConflictDoUpdate({
    target: schema.agents.name,
    set: {
      status: agent.status,
      currentTask: agent.currentTask ?? null,
      completedAt: agent.completedAt ?? null,
      lastEventTs: agent.lastEvent?.ts ?? null,
      lastEventMsg: agent.lastEvent?.msg ?? null,
      lastEventState: agent.lastEvent?.state ?? null,
      projectId: agent.projectId ?? null,
    },
  }).run();
}

/** Remove agent from SQLite. */
export function deleteAgentFromDb(name: string): void {
  db.delete(schema.agents).where(eq(schema.agents.name, name)).run();
}

/** Load agents from SQLite into the in-memory Map. Returns count loaded. */
export function loadAgentsFromDb(): number {
  const rows = db.select().from(schema.agents).all();
  let count = 0;
  for (const row of rows) {
    if (agents.has(row.name)) continue;
    const agent: AgentState = {
      name: row.name,
      task: row.task,
      containerId: row.containerId,
      vncPort: row.vncPort,
      tmuxSession: row.tmuxSession,
      status: row.status as AgentState['status'],
      projectId: row.projectId ?? undefined,
      currentTask: row.currentTask ?? undefined,
      createdAt: row.createdAt,
      completedAt: row.completedAt ?? undefined,
    };
    if (row.lastEventTs && row.lastEventState) {
      agent.lastEvent = {
        ts: row.lastEventTs,
        agent: row.name,
        state: row.lastEventState as AgentEvent['state'],
        msg: row.lastEventMsg ?? '',
      };
    }
    agents.set(row.name, agent);
    count++;
  }
  return count;
}

// ── Event store (SQLite) ────────────────────────────────────────────────────

export function getEvents(agentName?: string): AgentEvent[] {
  if (agentName) {
    return db.select().from(schema.events)
      .where(eq(schema.events.agent, agentName))
      .orderBy(schema.events.ts)
      .all()
      .map(r => ({ts: r.ts, agent: r.agent, state: r.state as AgentEvent['state'], msg: r.msg}));
  }
  return db.select().from(schema.events)
    .orderBy(schema.events.ts)
    .all()
    .map(r => ({ts: r.ts, agent: r.agent, state: r.state as AgentEvent['state'], msg: r.msg}));
}

export function getEventsForProject(projectId: string): AgentEvent[] {
  // Get agent names for this project
  const projectAgentNames = new Set<string>();
  for (const a of agents.values()) {
    if (a.projectId === projectId) projectAgentNames.add(a.name);
  }
  if (projectAgentNames.size === 0) return [];

  // Query all events and filter by project agents
  // (SQLite doesn't support IN with dynamic sets via Drizzle easily, so filter in JS)
  const all = db.select().from(schema.events)
    .orderBy(schema.events.ts)
    .all();
  return all
    .filter(r => projectAgentNames.has(r.agent))
    .map(r => ({ts: r.ts, agent: r.agent, state: r.state as AgentEvent['state'], msg: r.msg}));
}

export function pushEvent(event: AgentEvent): void {
  // Determine projectId from agent
  const agent = agents.get(event.agent);
  db.insert(schema.events).values({
    ts: event.ts,
    agent: event.agent,
    state: event.state,
    msg: event.msg,
    projectId: agent?.projectId ?? null,
  }).run();
}

// ── Chat store (SQLite) ─────────────────────────────────────────────────────

export function genChatId(): string {
  return `msg-${Date.now()}-${randomBytes(3).toString('hex')}`;
}

export function pushChat(projectId: string, msg: ChatMsg): void {
  db.insert(schema.messages).values({
    id: msg.id,
    role: msg.role,
    content: msg.content,
    ts: msg.ts,
    projectId,
    target: msg.target ?? null,
  }).onConflictDoNothing().run();
}

export function getChat(projectId: string, since?: string): ChatMsg[] {
  let rows;
  if (since) {
    rows = db.select().from(schema.messages)
      .where(eq(schema.messages.projectId, projectId))
      .orderBy(schema.messages.ts)
      .all()
      .filter(r => r.ts > since);
  } else {
    rows = db.select().from(schema.messages)
      .where(eq(schema.messages.projectId, projectId))
      .orderBy(schema.messages.ts)
      .all();
  }
  return rows.map(r => ({
    id: r.id,
    role: r.role as ChatMsg['role'],
    content: r.content,
    ts: r.ts,
    target: r.target ?? undefined,
  }));
}

// ── Completion waiters (in-memory, transient) ───────────────────────────────

const waiters = new Map<string, Array<(result?: string) => void>>();

export function waitForAgent(name: string, timeoutMs: number, signal?: AbortSignal): Promise<{completed: boolean; result?: string}> {
  const agent = agents.get(name);
  if (agent && agent.status === 'completed') {
    return Promise.resolve({completed: true});
  }

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      cleanup();
      resolve({completed: false});
    }, timeoutMs);

    const cb = (result?: string) => {
      cleanup();
      resolve({completed: true, result});
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const list = waiters.get(name);
      if (list) {
        const idx = list.indexOf(cb);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) waiters.delete(name);
      }
    };

    const onAbort = () => {
      cleanup();
      resolve({completed: false});
    };

    if (signal?.aborted) {
      resolve({completed: false});
      return;
    }
    signal?.addEventListener('abort', onAbort);

    if (!waiters.has(name)) waiters.set(name, []);
    waiters.get(name)!.push(cb);
  });
}

export function notifyWaiters(name: string, result?: string): void {
  const list = waiters.get(name);
  if (list) {
    for (const cb of list) cb(result);
    waiters.delete(name);
  }
}
