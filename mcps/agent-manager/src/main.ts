#!/usr/bin/env node
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createServer} from './index.js';

const SERVER_URL = process.env.ABOX_SERVER_URL || 'http://localhost:9900';

/** Wait for the Hono server to be reachable before starting MCP */
async function waitForServer(maxRetries = 10, intervalMs = 2000): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${SERVER_URL}/agents`, {signal: AbortSignal.timeout(2000)});
      if (res.ok) return true;
    } catch {
      // Server not ready yet
    }
    if (i < maxRetries - 1) {
      console.error(`Waiting for server at ${SERVER_URL}... (${i + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }
  return false;
}

(async () => {
  const serverReady = await waitForServer();
  if (!serverReady) {
    console.error(`Warning: Server at ${SERVER_URL} not reachable. MCP tools will fail until server starts.`);
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Agent Manager MCP server running on stdio');
})();
