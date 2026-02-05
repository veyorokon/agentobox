import {randomBytes} from 'node:crypto';
import type {AgentState, AgentEvent, ChatMsg} from './types.js';

// ── Agent state ──────────────────────────────────────────────────────────────

export const agents = new Map<string, AgentState>();

// ── Event store ──────────────────────────────────────────────────────────────

const MAX_EVENTS_PER_AGENT = 50;
const eventStore = new Map<string, AgentEvent[]>();

export function getEvents(agentName?: string): AgentEvent[] {
  if (agentName) return eventStore.get(agentName) ?? [];
  const all: AgentEvent[] = [];
  for (const events of eventStore.values()) all.push(...events);
  all.sort((a, b) => a.ts.localeCompare(b.ts));
  return all;
}

export function getEventsForProject(projectId: string): AgentEvent[] {
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

// ── Chat store ───────────────────────────────────────────────────────────────

const MAX_CHAT_PER_PROJECT = 200;
const chatStore = new Map<string, ChatMsg[]>();

export function genChatId(): string {
  return `msg-${Date.now()}-${randomBytes(3).toString('hex')}`;
}

export function pushChat(projectId: string, msg: ChatMsg): void {
  if (!chatStore.has(projectId)) chatStore.set(projectId, []);
  const list = chatStore.get(projectId)!;
  list.push(msg);
  if (list.length > MAX_CHAT_PER_PROJECT) list.shift();
}

export function getChat(projectId: string, since?: string): ChatMsg[] {
  const list = chatStore.get(projectId) ?? [];
  if (!since) return list;
  return list.filter(m => m.ts > since);
}

// ── Completion waiters ───────────────────────────────────────────────────────

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
