export type AgentStatus = 'idle' | 'working' | 'completed' | 'blocked' | 'dead';

export interface Agent {
  name: string;
  status: AgentStatus;
  message: string;
  createdAt: string;
  lastActivity: string;
  vncUrl?: string;
}

export interface Bento {
  id: string;
  name: string;
  agents: Agent[];
  agentoOnline: boolean;
  lastActivity: string;
}

export interface AgentEvent {
  ts: string;
  agent: string;
  state: AgentStatus;
  msg: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agento';
  content: string;
  ts: string;
}
