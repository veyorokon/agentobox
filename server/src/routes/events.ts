import {Hono} from 'hono';
import {handleEvent} from '../services/events.js';
import {getEvents, getEventsForProject} from '../state.js';

const app = new Hono();

// Receive event from agent container callback
app.post('/projects/:projectId/event', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const body = await c.req.json();
    const result = handleEvent(body, projectId);
    return c.json(result.body, result.status as 200);
  } catch {
    return c.json({error: 'invalid request'}, 400);
  }
});

// List events for a project
app.get('/projects/:projectId/events', (c) => {
  const projectId = c.req.param('projectId');
  const agentName = c.req.query('agent');

  let events = getEventsForProject(projectId);
  if (agentName) events = events.filter(e => e.agent === agentName);

  return c.json({events, count: events.length});
});

export default app;
