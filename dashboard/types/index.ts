// Types matching backend GraphQL schema

export type AgentStatus =
  | 'deploying'
  | 'running'
  | 'idle'
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
  mcpServers: Record<string, unknown>;
  workspacePath: string;
  instructions: string;
  createdAt: string;
}

export interface AgentMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  content: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface AgentEvent {
  id: number;
  eventType: string;
  data: Record<string, unknown>;
  agentId: string;
  agentName: string;
  createdAt: string;
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
