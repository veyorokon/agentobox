/**
 * Converts Message[] to renderable MessageItem[].
 *
 * Pattern lifted from Crush (charmbracelet/crush) — separates data model
 * from render model. One assistant Message with text + 2 tool calls becomes
 * 3 MessageItems (1 text + 2 tool items with matched results).
 *
 * @see docs/ARCHITECTURE.md, "ExtractMessageItems"
 * @see docs/ARCHITECTURE.md, "Patterns to Implement"
 */
import type { Message, MessageItem, ContentPart, ToolStatus } from '@/types';

type ToolUsePart = Extract<ContentPart, { type: 'tool_use' }>;
type ToolResultPart = Extract<ContentPart, { type: 'tool_result' }>;

export function extractMessageItems(messages: Message[]): MessageItem[] {
  // Build a map of tool_use_id -> tool_result for matching
  const toolResults = new Map<string, ToolResultPart>();
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    for (const part of msg.parts) {
      if (part.type === 'tool_result') {
        toolResults.set(part.tool_use_id, part);
      }
    }
  }

  const items: MessageItem[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      // User messages that are pure tool_results don't get a user bubble
      const textParts = msg.parts.filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text');
      if (textParts.length > 0) {
        items.push({
          type: 'user',
          message: msg,
          text: textParts.map((p) => p.text).join('\n'),
        });
      }
      // tool_result parts are attached to tool items below
      continue;
    }

    // Assistant message — extract text and tool_use parts separately
    const texts: string[] = [];
    const toolUses: ToolUsePart[] = [];

    for (const part of msg.parts) {
      if (part.type === 'text' && part.text.trim()) {
        texts.push(part.text);
      } else if (part.type === 'tool_use') {
        toolUses.push(part);
      }
    }

    // Text item (if any text parts)
    if (texts.length > 0) {
      items.push({
        type: 'assistant',
        message: msg,
        text: texts.join('\n'),
      });
    }

    // Tool items (one per tool_use, with matched result)
    for (const toolUse of toolUses) {
      const result = toolResults.get(toolUse.id);
      let status: ToolStatus;
      if (!result) {
        status = 'running';
      } else if (result.is_error) {
        status = 'error';
      } else {
        status = 'success';
      }

      items.push({
        type: 'tool',
        message: msg,
        toolUse,
        toolResult: result,
        status,
      });
    }
  }

  return items;
}
