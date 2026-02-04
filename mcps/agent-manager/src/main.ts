#!/usr/bin/env node
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createServer} from './index.js';
import {agents, recoverAgents} from './tools/agents.js';
import {startCallbackServer} from './utils/callback.js';

function setupSignalHandlers(): void {
  // Agents persist across MCP restarts — recoverAgents() re-discovers them.
  // Only clean up the in-memory map, not the containers.
  process.on('SIGINT', () => {
    agents.clear();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    agents.clear();
    process.exit(0);
  });
}

(async () => {
  // Recover any agents from previous MCP session
  const recovered = recoverAgents();
  if (recovered > 0) {
    console.error(`Recovered ${recovered} agent(s) from running containers`);
  }

  const server = createServer();
  startCallbackServer();
  setupSignalHandlers();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Agent Manager MCP server running on stdio');
})();
