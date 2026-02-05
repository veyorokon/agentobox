import {Hono} from 'hono';
import {pushChat, getChat, genChatId, agents} from '../state.js';
import {bus} from '../bus.js';
import {sendKeysCore} from '../services/agents.js';
import {sendMessage} from '../services/agento.js';
import {tmuxHasSession} from '../utils/tmux.js';
import type {ChatMsg} from '../types.js';

function emitChat(projectId: string, msg: ChatMsg) {
  pushChat(projectId, msg);
  bus.emitNewChat(projectId, msg);
}

const app = new Hono();

// Send a chat message (to Agento or directly to an agent)
app.post('/projects/:projectId/chat', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const data = await c.req.json() as {target?: string; content?: string};
    const content = data.content?.trim();
    if (!content) {
      return c.json({error: 'missing content'}, 400);
    }

    const target = data.target || 'agento';
    const userMsg: ChatMsg = {id: genChatId(), role: 'user', content, ts: new Date().toISOString(), target};
    emitChat(projectId, userMsg);

    if (target === 'agento') {
      try {
        const replyText = await sendMessage(projectId, content);
        const reply: ChatMsg = {id: genChatId(), role: 'agento', content: replyText, ts: new Date().toISOString()};
        emitChat(projectId, reply);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[agento] LLM error: ${errMsg}`);
        const reply: ChatMsg = {id: genChatId(), role: 'agento', content: `Error: ${errMsg}`, ts: new Date().toISOString()};
        emitChat(projectId, reply);
      }
    } else {
      // Direct agent messaging via tmux
      const agent = agents.get(target);
      if (!agent) {
        const reply: ChatMsg = {id: genChatId(), role: 'agento', content: `Agent "${target}" not found.`, ts: new Date().toISOString()};
        emitChat(projectId, reply);
      } else if (!tmuxHasSession(target)) {
        const reply: ChatMsg = {id: genChatId(), role: 'agento', content: `Agent "${target}" session is not active.`, ts: new Date().toISOString()};
        emitChat(projectId, reply);
      } else {
        await sendKeysCore(target, [{text: content}, {key: 'Enter'}]);
        const reply: ChatMsg = {id: genChatId(), role: 'agento', content: `Sent to ${target}.`, ts: new Date().toISOString()};
        emitChat(projectId, reply);
      }
    }

    return c.json({ok: true});
  } catch {
    return c.json({error: 'invalid request'}, 400);
  }
});

// Get chat messages (with optional ?since= for incremental polling)
app.get('/projects/:projectId/chat', (c) => {
  const projectId = c.req.param('projectId');
  const since = c.req.query('since');
  const messages = getChat(projectId, since);
  return c.json({messages, count: messages.length});
});

export default app;
