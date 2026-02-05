import {existsSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const DB_PATH = process.env.ABOX_DB_PATH || './data/agentobox.db';

// Ensure parent directory exists
const dir = dirname(DB_PATH);
if (!existsSync(dir)) mkdirSync(dir, {recursive: true});

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, {schema});

/** Create tables if they don't exist. Called on startup. */
export function initDb(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      task TEXT NOT NULL DEFAULT '',
      container_id TEXT NOT NULL,
      vnc_port INTEGER NOT NULL,
      tmux_session TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      project_id TEXT,
      current_task TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      last_event_ts TEXT,
      last_event_msg TEXT,
      last_event_state TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      agent TEXT NOT NULL,
      state TEXT NOT NULL,
      msg TEXT NOT NULL DEFAULT '',
      project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      ts TEXT NOT NULL,
      project_id TEXT NOT NULL,
      target TEXT
    );

    CREATE TABLE IF NOT EXISTS conversations (
      project_id TEXT PRIMARY KEY,
      history TEXT NOT NULL DEFAULT '[]'
    );
  `);
}
