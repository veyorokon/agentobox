import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {cors} from 'hono/cors';
import {httpInstrumentationMiddleware} from '@hono/otel';
import {SERVER_PORT} from './types.js';
import {initDb} from './db/index.js';
import {recoverAgents} from './services/agents.js';
import {agents} from './state.js';
import {logger} from './logger.js';
import {shutdownOtel} from './instrumentation.js';

import agentRoutes from './routes/agents.js';
import eventRoutes from './routes/events.js';
import chatRoutes from './routes/chat.js';
import sseRoutes from './routes/sse.js';

const app = new Hono();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use('*', cors());
app.use(
  '*',
  httpInstrumentationMiddleware({
    serviceName: 'agentobox-server',
    serviceVersion: '0.1.0',
  }),
);

// Pino access log (replaces hono/logger)
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  logger.info(
    {method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start},
    `${c.req.method} ${c.req.path}`,
  );
});

// ── Error handling ───────────────────────────────────────────────────────────

app.onError((err, c) => {
  logger.error({err}, err.message);
  return c.json({error: err.message}, 500);
});

// ── Versioned API routes (/api/v1) ───────────────────────────────────────────

app.route('/api/v1', agentRoutes);
app.route('/api/v1', eventRoutes);
app.route('/api/v1', chatRoutes);
app.route('/api/v1', sseRoutes);

// ── Health ──────────────────────────────────────────────────────────────────

const startedAt = Date.now();

app.get('/api/v1/health', (c) => {
  return c.json({
    ok: true,
    agents: agents.size,
    uptime: Math.round((Date.now() - startedAt) / 1000),
  });
});

// ── 404 ──────────────────────────────────────────────────────────────────────

app.notFound((c) => {
  return c.json({error: 'not found'}, 404);
});

// ── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  initDb();
  logger.info('Database initialized');

  const recovered = await recoverAgents();
  if (recovered > 0) {
    logger.info({recovered}, `Recovered ${recovered} agent(s)`);
  }

  const server = serve(
    {
      fetch: app.fetch,
      port: SERVER_PORT,
    },
    (info) => {
      logger.info({port: info.port}, `Agentobox server listening on port ${info.port}`);
    },
  );

  const shutdown = async (signal: string) => {
    logger.info({signal}, `${signal} received, shutting down...`);
    await shutdownOtel();
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();

