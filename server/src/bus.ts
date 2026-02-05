import {EventEmitter} from 'node:events';
import type {AgentEvent, ChatMsg} from './types.js';

class EventBus extends EventEmitter {
  emitAgentUpdate(projectId: string, agents: Array<Record<string, unknown>>) {
    this.emit('agent_update', projectId, agents);
  }

  emitNewEvent(projectId: string, event: AgentEvent) {
    this.emit('new_event', projectId, event);
  }

  emitNewChat(projectId: string, message: ChatMsg) {
    this.emit('new_chat', projectId, message);
  }
}

export const bus = new EventBus();
