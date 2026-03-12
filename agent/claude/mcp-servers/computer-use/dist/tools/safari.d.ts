/**
 * Safari DOM bridge — page_map, scroll_to, find_element tools.
 *
 * Gives Claude structural awareness of the browser page by querying Safari's
 * DOM via osascript and translating viewport coordinates to screen coordinates
 * that work with the computer tool's click/scroll actions.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function registerSafari(server: McpServer): void;
