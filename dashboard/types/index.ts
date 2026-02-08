// Types matching backend GraphQL schema

export type AgentStatus =
  | 'deploying'
  | 'running'
  | 'stopped'
  | 'error';

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  vncUrl: string;
  sandboxId: string;
  runtime: string;
  teamName: string;
  parentSessionId: string;
  sessionId: string;
  model: string;
  cwd: string;
  transcriptPath: string;
  permissionMode: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface AgentEvent {
  eventType: string;
  data: Record<string, unknown>;
  agentId: string;
  agentName: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
}

export interface AuthPayload {
  user: User;
  token: string;
}
