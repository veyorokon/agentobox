import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
/**
 * Human-like scrolling: break into small steps with variable delays,
 * simulating real scroll wheel notches (40-120px each).
 * Exported for reuse in safari.ts scroll_to.
 */
export declare function humanScroll(direction: 'up' | 'down', amount: number): Promise<void>;
/**
 * Get the scale factor from API image coordinates to logical screen coordinates.
 * This is the inverse of the downsampling we apply to fit API limits.
 */
export declare function getApiToLogicalScale(): Promise<number>;
export declare function registerComputer(server: McpServer): void;
