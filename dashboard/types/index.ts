// Types matching backend GraphQL schema

export type AgentStatus =
  | 'deploying'
  | 'working'
  | 'conversing'
  | 'needs_info'
  | 'blocked'
  | 'completed'
  | 'goal_changed'
  | 'dead'
  | 'terminated';

export type GoalStatus = 'active' | 'satisfied' | 'abandoned';

export interface Goal {
  id: string;
  text: string;
  contextPath: string;
  plan: string[];
  status: GoalStatus;
  createdAt: string;
  satisfiedAt: string | null;
}

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  confidence: number;
  sentiment: string;
  summary: string;
  reasoning: string;
  output: string;
  vncUrl: string;
  sandboxId: string;
  runtime: string;
  createdAt: string;
  completedAt: string | null;
  goal: Goal | null;
}

export interface Project {
  id: string;
  name: string;
  defaultRuntime: string;
  createdAt: string;
}

export interface AgentEvent {
  id: string;
  eventType: string;
  data: Record<string, unknown>;
  timestamp: string;
  agent: {
    id: string;
    name: string;
  };
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
