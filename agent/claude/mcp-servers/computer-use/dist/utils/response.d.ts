import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export declare function jsonResult<T extends Record<string, unknown>>(data: T): CallToolResult & {
    structuredContent: T;
};
