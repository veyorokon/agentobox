import {Hono} from 'hono';
import {createAgentCore, killAgentCore, sendKeysCore, readOutputCore, listAgentsCore, recoverAgents, waitForOutputCore} from '../services/agents.js';
import {waitForAgent} from '../state.js';

const app = new Hono();

// List agents for a project (use _all for unscoped)
app.get('/projects/:projectId/agents', async (c) => {
  const projectId = c.req.param('projectId');
  const result = await listAgentsCore(projectId === '_all' ? undefined : projectId);
  return c.json({agents: result.agents, count: result.count});
});

// Create agent
app.post('/agents', async (c) => {
  try {
    const body = await c.req.json();
    const result = await createAgentCore({
      name: body.name,
      task: body.task,
      projectId: body.projectId,
      autonomous: body.autonomous,
      api_key: body.api_key,
      oauth_token: body.oauth_token,
    });
    return c.json({...result, ready: true}, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({error: msg}, 500);
  }
});

// Kill agent
app.delete('/agents/:name', async (c) => {
  try {
    const name = c.req.param('name');
    const result = await killAgentCore(name);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({error: msg}, 404);
  }
});

// Send keys to agent
app.post('/agents/:name/keys', async (c) => {
  try {
    const name = c.req.param('name');
    const body = await c.req.json();
    const result = await sendKeysCore(name, body.keys);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({error: msg}, 400);
  }
});

// Read agent output
app.get('/agents/:name/output', async (c) => {
  try {
    const name = c.req.param('name');
    const lines = parseInt(c.req.query('lines') ?? '200', 10);
    const result = await readOutputCore(name, lines);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({error: msg}, 404);
  }
});

// Recover agents from running containers
app.post('/agents/recover', (c) => {
  const count = recoverAgents();
  return c.json({ok: true, recovered: count});
});

// Wait for text in agent output (long-poll)
app.post('/agents/:name/wait-output', async (c) => {
  try {
    const name = c.req.param('name');
    const body = await c.req.json();
    const text = body.text as string;
    const timeout = ((body.timeout as number) ?? 30) * 1000;
    const signal = c.req.raw.signal;
    const result = await waitForOutputCore(name, text, timeout, signal);
    return c.json({ok: result.found, found: result.found, text, elapsed: result.elapsed, timedOut: !result.found});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({error: msg}, 400);
  }
});

// Wait for agent completion (long-poll)
app.post('/agents/:name/wait-completion', async (c) => {
  try {
    const name = c.req.param('name');
    const body = await c.req.json().catch(() => ({}));
    const timeout = ((body.timeout as number) ?? 300) * 1000;
    const signal = c.req.raw.signal;
    const {completed} = await waitForAgent(name, timeout, signal);
    return c.json({ok: completed, completed, agent: name, timedOut: !completed});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({error: msg}, 400);
  }
});

export default app;
