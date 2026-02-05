import {Hono} from 'hono';
import {streamSSE} from 'hono/streaming';
import {metrics} from '@opentelemetry/api';
import {bus} from '../bus.js';
import {sseLog} from '../logger.js';
import type {AgentEvent, ChatMsg} from '../types.js';

const meter = metrics.getMeter('agentobox-server');
const activeConnections = meter.createUpDownCounter('sse.active_connections');
const eventsEmitted = meter.createCounter('sse.events_emitted');

const app = new Hono();

app.get('/projects/:projectId/stream', (c) => {
  const projectId = c.req.param('projectId');
  const connectedAt = Date.now();

  sseLog.info({projectId}, 'SSE client connected');
  activeConnections.add(1, {projectId});

  return streamSSE(c, async (stream) => {
    let alive = true;

    const onAgentUpdate = (pid: string, agents: Array<Record<string, unknown>>) => {
      if (pid !== projectId || !alive) return;
      eventsEmitted.add(1, {type: 'agent_update', projectId});
      stream.writeSSE({event: 'agent_update', data: JSON.stringify({agents})}).catch(() => { alive = false; });
    };

    const onNewEvent = (pid: string, event: AgentEvent) => {
      if (pid !== projectId || !alive) return;
      eventsEmitted.add(1, {type: 'new_event', projectId});
      stream.writeSSE({event: 'new_event', data: JSON.stringify({event})}).catch(() => { alive = false; });
    };

    const onNewChat = (pid: string, message: ChatMsg) => {
      if (pid !== projectId || !alive) return;
      eventsEmitted.add(1, {type: 'new_chat', projectId});
      stream.writeSSE({event: 'new_chat', data: JSON.stringify({message})}).catch(() => { alive = false; });
    };

    bus.on('agent_update', onAgentUpdate);
    bus.on('new_event', onNewEvent);
    bus.on('new_chat', onNewChat);

    // Heartbeat every 15s to keep connection alive
    const heartbeat = setInterval(() => {
      if (!alive) return;
      stream.writeSSE({event: 'keepalive', data: ''}).catch(() => { alive = false; });
    }, 15000);

    // Block until client disconnects
    stream.onAbort(() => {
      alive = false;
    });

    // Keep the stream open
    while (alive) {
      await new Promise(r => setTimeout(r, 1000));
    }

    clearInterval(heartbeat);
    bus.off('agent_update', onAgentUpdate);
    bus.off('new_event', onNewEvent);
    bus.off('new_chat', onNewChat);

    const durationSec = Math.round((Date.now() - connectedAt) / 1000);
    activeConnections.add(-1, {projectId});
    sseLog.info({projectId, durationSec}, `SSE client disconnected after ${durationSec}s`);
  });
});

export default app;
