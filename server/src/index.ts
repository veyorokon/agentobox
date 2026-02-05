import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {cors} from 'hono/cors';
import {logger} from 'hono/logger';
import {SERVER_PORT} from './types.js';
import {initDb} from './db/index.js';
import {recoverAgents} from './services/agents.js';
import {handleEvent} from './services/events.js';
import {listAgentsCore} from './services/agents.js';
import {getEvents} from './state.js';

import agentRoutes from './routes/agents.js';
import eventRoutes from './routes/events.js';
import chatRoutes from './routes/chat.js';
import sseRoutes from './routes/sse.js';

const app = new Hono();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use('*', cors());
app.use('*', logger());

// ── Error handling ───────────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error(`[error] ${err.message}`);
  return c.json({error: err.message}, 500);
});

// ── Versioned API routes (/api/v1) ───────────────────────────────────────────

app.route('/api/v1', agentRoutes);
app.route('/api/v1', eventRoutes);
app.route('/api/v1', chatRoutes);
app.route('/api/v1', sseRoutes);

// ── Backward-compat (unversioned) ────────────────────────────────────────────
// Agent containers POST to /event (hardcoded in Stop hooks + CLAUDE.md).
// These stay until container templates are updated to use /api/v1/ paths.

// POST /event (unscoped — agent containers use this)
app.post('/event', async (c) => {
  try {
    const body = await c.req.json();
    const result = handleEvent(body);
    return c.json(result.body, result.status as 200);
  } catch {
    return c.json({error: 'invalid request'}, 400);
  }
});

// GET /agents (unscoped — list all)
app.get('/agents', async (c) => {
  const result = await listAgentsCore();
  return c.json({agents: result.agents, count: result.count});
});

// GET /events (unscoped — debugging convenience)
app.get('/events', (c) => {
  const agentName = c.req.query('agent');
  const events = getEvents(agentName);
  return c.json({events, count: events.length});
});

// ── 404 ──────────────────────────────────────────────────────────────────────

app.notFound((c) => {
  return c.json({error: 'not found'}, 404);
});

// ── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  initDb();
  console.error('Database initialized');

  const recovered = await recoverAgents();
  if (recovered > 0) {
    console.error(`Recovered ${recovered} agent(s)`);
  }

  const server = serve({
    fetch: app.fetch,
    port: SERVER_PORT,
  }, (info) => {
    console.error(`Agentobox server listening on port ${info.port}`);
  });

  process.on('SIGTERM', () => {
    console.error('SIGTERM received, shutting down...');
    server.close(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    console.error('SIGINT received, shutting down...');
    server.close(() => process.exit(0));
  });
}

main();
