import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerAll} from './tools/index.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'agent-manager-mcp',
    version: '0.1.0',
  });

  registerAll(server);

  return server;
}
