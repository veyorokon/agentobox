import Anthropic from '@anthropic-ai/sdk';
import {eq} from 'drizzle-orm';
import {db} from '../db/index.js';
import * as schema from '../db/schema.js';
import {sendKeysCore, readOutputCore, listAgentsCore} from './agents.js';
import type {KeyAction} from './agents.js';

const MODEL = process.env.ABOX_LLM_MODEL || 'claude-sonnet-4-20250514';
const MAX_HISTORY = 50;

const client = new Anthropic();

function loadHistory(projectId: string): Anthropic.MessageParam[] {
  const row = db.select().from(schema.conversations)
    .where(eq(schema.conversations.projectId, projectId))
    .get();
  if (!row) return [];
  try { return JSON.parse(row.history); } catch { return []; }
}

function saveHistory(projectId: string, history: Anthropic.MessageParam[]): void {
  db.insert(schema.conversations).values({
    projectId,
    history: JSON.stringify(history),
  }).onConflictDoUpdate({
    target: schema.conversations.projectId,
    set: {history: JSON.stringify(history)},
  }).run();
}

const SYSTEM_PROMPT = `You are Agento, an AI coordinator for a fleet of worker agents. Each agent runs inside an isolated Linux desktop container with Chrome and Claude Code.

Your capabilities:
- List all active agents and their status
- Send instructions to running agents via their terminal
- Read agent output to check progress

You do NOT create or kill agents — the user manages agent lifecycle through the dashboard.

Guidelines:
- When using send_keys, ALWAYS include {key: "Enter"} as the last action to submit the message
- After sending a task, use read_output to check progress
- Be very concise — 1-2 sentences max. The user sees this in a small chat panel
- Do not narrate what you think will happen. Just do it and report the result briefly`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_agents',
    description: 'List all active worker agents with their status, tasks, and VNC URLs',
    input_schema: {type: 'object' as const, properties: {}, required: []},
  },
  {
    name: 'send_keys',
    description: "Send keystrokes to an agent's Claude Code terminal. IMPORTANT: Always end with {key: \"Enter\"} to submit. Example: keys: [{text: \"do something\"}, {key: \"Enter\"}]",
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {type: 'string', description: 'Name of the agent'},
        keys: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: {type: 'string'},
              key: {type: 'string'},
            },
          },
          description: 'Ordered list of key actions',
        },
      },
      required: ['name', 'keys'],
    },
  },
  {
    name: 'read_output',
    description: "Read recent terminal output from an agent's Claude Code session",
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {type: 'string', description: 'Name of the agent'},
        lines: {type: 'number', description: 'Number of lines to capture (default: 200)'},
      },
      required: ['name'],
    },
  },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case 'list_agents': {
        const result = await listAgentsCore();
        return JSON.stringify(result);
      }
      case 'send_keys': {
        const result = await sendKeysCore(input.name as string, input.keys as KeyAction[]);
        return JSON.stringify(result);
      }
      case 'read_output': {
        const result = await readOutputCore(input.name as string, input.lines as number | undefined);
        return JSON.stringify(result);
      }
      default:
        return JSON.stringify({error: `Unknown tool: ${name}`});
    }
  } catch (err) {
    return JSON.stringify({error: err instanceof Error ? err.message : String(err)});
  }
}

export async function sendMessage(projectId: string, content: string): Promise<string> {
  const history = loadHistory(projectId);

  history.push({role: 'user', content});

  while (history.length > MAX_HISTORY) history.shift();

  let response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages: history,
  });

  // Tool-use loop: keep going until we get a final text response
  while (response.stop_reason === 'tool_use') {
    const assistantContent = response.content;
    history.push({role: 'assistant', content: assistantContent});

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of assistantContent) {
      if (block.type === 'tool_use') {
        const result = await executeTool(block.name, block.input as Record<string, unknown>);
        toolResults.push({type: 'tool_result', tool_use_id: block.id, content: result});
      }
    }

    history.push({role: 'user', content: toolResults});

    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: history,
    });
  }

  // Extract final text
  const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
  const reply = textBlocks.map(b => b.text).join('\n') || 'No response generated.';

  history.push({role: 'assistant', content: response.content});

  while (history.length > MAX_HISTORY) history.shift();

  saveHistory(projectId, history);

  return reply;
}
