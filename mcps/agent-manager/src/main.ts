#!/usr/bin/env node
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createServer} from './index.js';
import {agents, recoverAgents} from './tools/agents.js';
import {tmuxKill} from './utils/tmux.js';
import {dockerStop, dockerRm} from './utils/docker.js';
import {startCallbackServer} from './utils/callback.js';

function cleanupAll(): void {
  for (const [name, agent] of agents) {
    try { tmuxKill(name); } catch { /* ignore */ }
    try { dockerStop(name); } catch { /* ignore */ }
    try { dockerRm(name); } catch { /* ignore */ }
    agents.delete(name);
  }
}

function setupSignalHandlers(): void {
  process.on('SIGINT', () => {
    cleanupAll();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanupAll();
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
