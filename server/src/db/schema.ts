import {sqliteTable, text, integer} from 'drizzle-orm/sqlite-core';

export const agents = sqliteTable('agents', {
  name: text('name').primaryKey(),
  task: text('task').notNull().default(''),
  containerId: text('container_id').notNull(),
  vncPort: integer('vnc_port').notNull(),
  tmuxSession: text('tmux_session').notNull(),
  status: text('status').notNull().default('idle'),
  projectId: text('project_id'),
  currentTask: text('current_task'),
  createdAt: integer('created_at').notNull(),
  completedAt: integer('completed_at'),
  lastEventTs: text('last_event_ts'),
  lastEventMsg: text('last_event_msg'),
  lastEventState: text('last_event_state'),
});

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({autoIncrement: true}),
  ts: text('ts').notNull(),
  agent: text('agent').notNull(),
  state: text('state').notNull(),
  msg: text('msg').notNull().default(''),
  projectId: text('project_id'),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  ts: text('ts').notNull(),
  projectId: text('project_id').notNull(),
  target: text('target'),
});

export const conversations = sqliteTable('conversations', {
  projectId: text('project_id').primaryKey(),
  history: text('history').notNull().default('[]'),
});
