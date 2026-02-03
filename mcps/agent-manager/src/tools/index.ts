import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerAgents} from './agents.js';

export function registerAll(server: McpServer): void {
  registerAgents(server);
}
