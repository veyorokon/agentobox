import Anthropic from '@anthropic-ai/sdk';
import {createAgentCore, killAgentCore, sendKeysCore, readOutputCore, listAgentsCore} from '../tools/agents.js';
import type {KeyAction} from '../tools/agents.js';

const MODEL = process.env.ABOX_LLM_MODEL || 'claude-sonnet-4-20250514';
const MAX_HISTORY = 50;

const client = new Anthropic();
const conversations = new Map<string, Anthropic.MessageParam[]>();

const SYSTEM_PROMPT = `You are Agento, an AI orchestrator managing a fleet of worker agents. Each agent runs inside an isolated Linux desktop container with Chrome and Claude Code.

Your capabilities:
- Create new agents to perform tasks (browsing, research, coding, etc.)
- Send instructions to running agents via their terminal
- Read agent output to check progress
- Kill agents when they're done or stuck
- List all active agents and their status

Guidelines:
- When asked to do something, decide whether to delegate to an existing agent or create a new one
- Agent names must be lowercase with no spaces (e.g., "researcher", "browser-1")
- When sending keys to an agent, the text gets typed into their Claude Code session
- After sending a task, you can read_output to check if the agent is making progress
- Be concise in your responses — the user sees this in a chat panel
- If an agent is stuck or dead, kill it and create a new one`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_agents',
    description: 'List all active worker agents with their status, tasks, and VNC URLs',
    input_schema: {type: 'object' as const, properties: {}, required: []},
  },
  {
    name: 'create_agent',
    description: 'Create a new worker agent. Returns when the agent is fully interactive and ready for tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {type: 'string', description: 'Unique name (lowercase, no spaces)'},
        task: {type: 'string', description: 'Description of the task for the agent'},
      },
      required: ['name'],
    },
  },
  {
    name: 'kill_agent',
    description: 'Stop and remove a worker agent',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {type: 'string', description: 'Name of the agent to kill'},
      },
      required: ['name'],
    },
  },
  {
    name: 'send_keys',
    description: "Send keystrokes to an agent's Claude Code terminal. Use {text: \"...\"} for literal text and {key: \"Enter\"} for special keys.",
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
      case 'create_agent': {
        const result = await createAgentCore({
          name: input.name as string,
          task: input.task as string | undefined,
        });
        return JSON.stringify(result);
      }
      case 'kill_agent': {
        const result = await killAgentCore(input.name as string);
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
  if (!conversations.has(projectId)) conversations.set(projectId, []);
  const history = conversations.get(projectId)!;

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

  return reply;
}
