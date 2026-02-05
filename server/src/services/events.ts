import type {AgentEvent, AgentStatus} from '../types.js';
import {VALID_STATES} from '../types.js';
import {agents, pushEvent, notifyWaiters, persistAgent} from '../state.js';
import {bus} from '../bus.js';
import {eventLog} from '../logger.js';

/** Process an incoming event from an agent container callback. */
export function handleEvent(data: {agent?: string; state?: string; msg?: string; task?: string}, projectId?: string): {status: number; body: Record<string, unknown>} {
  const name = data.agent;
  if (!name) return {status: 400, body: {error: 'missing agent name'}};

  const state = data.state as AgentStatus;
  if (!state || !VALID_STATES.includes(state)) {
    return {status: 400, body: {error: `invalid state, must be one of: ${VALID_STATES.join(', ')}`}};
  }

  const event: AgentEvent = {
    ts: new Date().toISOString(),
    agent: name,
    state,
    msg: (data.msg ?? '').slice(0, 100),
  };

  pushEvent(event);

  // Determine project for bus emission
  const agent = agents.get(name);
  const pid = projectId || agent?.projectId;
  if (pid) bus.emitNewEvent(pid, event);

  // Update agent state if tracked
  if (agent) {
    agent.status = state;
    agent.lastEvent = event;
    if (projectId && !agent.projectId) agent.projectId = projectId;
    if (data.task) agent.currentTask = data.task.slice(0, 100);
    if (state === 'completed') agent.completedAt = Date.now();
    persistAgent(agent);
    eventLog.info({agent: name, state, task: data.task}, `${name}: ${state}${data.task ? ` [${data.task}]` : ''}${event.msg ? ` — ${event.msg}` : ''}`);
  }

  if (state === 'completed') notifyWaiters(name);

  return {status: 200, body: {ok: true}};
}
