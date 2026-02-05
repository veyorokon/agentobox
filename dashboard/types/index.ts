export type AgentStatus = 'idle' | 'working' | 'completed' | 'blocked' | 'dead' | 'deploying';

export interface Agent {
  name: string;
  status: AgentStatus;
  task: string;       // Overarching goal (from TodoWrite activeForm)
  message: string;    // Immediate action (from computer-use intent)
  createdAt: string;
  lastActivity: string;
  vncUrl?: string;
}

export interface Project {
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
