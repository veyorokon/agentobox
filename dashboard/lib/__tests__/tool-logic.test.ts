/**
 * Tests for frontend tool logic: resultAsString, computeDiff, screenshot URL extraction,
 * hasExpansionData, getToolLabel, feed adapter.
 *
 * Run: cd dashboard && npx vitest run lib/__tests__/tool-logic.test.ts
 */

import { describe, it, expect } from 'vitest';

// ── resultAsString (from tool-expansion.tsx) ──
// Re-implement here since tool-expansion uses 'use client' and JSX
function resultAsString(result: string | any[]): string {
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    return result
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('\n');
  }
  return '';
}

describe('resultAsString', () => {
  it('returns string as-is', () => {
    expect(resultAsString('hello world')).toBe('hello world');
  });

  it('returns empty string for empty string', () => {
    expect(resultAsString('')).toBe('');
  });

  it('extracts text from single text block', () => {
    expect(resultAsString([{ type: 'text', text: 'line one' }])).toBe('line one');
  });

  it('joins multiple text blocks with newline', () => {
    const blocks = [
      { type: 'text', text: 'line one' },
      { type: 'text', text: 'line two' },
    ];
    expect(resultAsString(blocks)).toBe('line one\nline two');
  });

  it('skips image blocks', () => {
    const blocks = [
      { type: 'text', text: 'Screenshot taken' },
      { type: 'image', source: { type: 'base64', data: 'abc123' } },
    ];
    expect(resultAsString(blocks)).toBe('Screenshot taken');
  });

  it('returns empty string for image-only blocks', () => {
    const blocks = [
      { type: 'image', source: { type: 'base64', data: 'abc' } },
    ];
    expect(resultAsString(blocks)).toBe('');
  });

  it('returns empty string for empty array', () => {
    expect(resultAsString([])).toBe('');
  });

  it('handles blocks missing text property', () => {
    const blocks = [{ type: 'text' }];
    expect(resultAsString(blocks)).toBe('');
  });
});

// ── computeDiff (re-implemented for testing) ──

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  lineNumber: number;
  text: string;
}

function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const lines: DiffLine[] = [];
  let lineNum = 1;

  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const ops: { type: 'equal' | 'delete' | 'insert'; text: string }[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: 'equal', text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'insert', text: newLines[j - 1] });
      j--;
    } else {
      ops.push({ type: 'delete', text: oldLines[i - 1] });
      i--;
    }
  }
  ops.reverse();

  for (const op of ops) {
    if (op.type === 'equal') {
      lines.push({ type: 'context', lineNumber: lineNum, text: op.text });
    } else if (op.type === 'delete') {
      lines.push({ type: 'remove', lineNumber: lineNum, text: op.text });
    } else {
      lines.push({ type: 'add', lineNumber: lineNum, text: op.text });
    }
    lineNum++;
  }

  return lines;
}

describe('computeDiff', () => {
  it('identical strings produce all context lines', () => {
    const diff = computeDiff('a\nb\nc', 'a\nb\nc');
    expect(diff).toHaveLength(3);
    expect(diff.every((l) => l.type === 'context')).toBe(true);
  });

  it('single line change produces remove + add', () => {
    const diff = computeDiff('hello', 'world');
    const removes = diff.filter((l) => l.type === 'remove');
    const adds = diff.filter((l) => l.type === 'add');
    expect(removes).toHaveLength(1);
    expect(removes[0].text).toBe('hello');
    expect(adds).toHaveLength(1);
    expect(adds[0].text).toBe('world');
  });

  it('adding a line', () => {
    const diff = computeDiff('a\nb', 'a\nb\nc');
    const adds = diff.filter((l) => l.type === 'add');
    expect(adds).toHaveLength(1);
    expect(adds[0].text).toBe('c');
  });

  it('removing a line', () => {
    const diff = computeDiff('a\nb\nc', 'a\nc');
    const removes = diff.filter((l) => l.type === 'remove');
    expect(removes).toHaveLength(1);
    expect(removes[0].text).toBe('b');
  });

  it('empty old string (all additions)', () => {
    const diff = computeDiff('', 'new line');
    expect(diff.filter((l) => l.type === 'add')).toHaveLength(1);
  });

  it('empty new string (all removals)', () => {
    const diff = computeDiff('old line', '');
    expect(diff.filter((l) => l.type === 'remove')).toHaveLength(1);
  });

  it('multi-line change preserves context', () => {
    const diff = computeDiff('a\nb\nc\nd', 'a\nX\nc\nd');
    expect(diff[0]).toEqual({ type: 'context', lineNumber: 1, text: 'a' });
    // b → X should be remove + add
    const removes = diff.filter((l) => l.type === 'remove');
    const adds = diff.filter((l) => l.type === 'add');
    expect(removes.some((r) => r.text === 'b')).toBe(true);
    expect(adds.some((a) => a.text === 'X')).toBe(true);
  });
});

// ── computeWriteDiff ──

function computeWriteDiff(content: string): DiffLine[] {
  return content.split('\n').map((line, i) => ({
    type: 'add' as const,
    lineNumber: i + 1,
    text: line,
  }));
}

describe('computeWriteDiff', () => {
  it('all lines are additions', () => {
    const diff = computeWriteDiff('line1\nline2\nline3');
    expect(diff).toHaveLength(3);
    expect(diff.every((l) => l.type === 'add')).toBe(true);
    expect(diff[0].text).toBe('line1');
    expect(diff[2].lineNumber).toBe(3);
  });

  it('single line', () => {
    const diff = computeWriteDiff('only line');
    expect(diff).toHaveLength(1);
    expect(diff[0]).toEqual({ type: 'add', lineNumber: 1, text: 'only line' });
  });
});

// ── getScreenshotUrl (from tool-expansion.tsx extractImageUrl) ──

interface ContentBlock {
  type: string;
  text?: string;
  source?: { type: string; media_type?: string; data?: string; url?: string };
  [key: string]: unknown;
}

interface ToolUseDetail {
  name: string;
  input: Record<string, any>;
  result: string | ContentBlock[];
  isError?: boolean;
}

function getScreenshotUrl(tool: ToolUseDetail): string | undefined {
  if (Array.isArray(tool.result)) {
    const imgBlock = tool.result.find((b: ContentBlock) => b.type === 'image');
    if (imgBlock?.source?.url) return imgBlock.source.url;
    if (imgBlock?.source?.data) {
      return `data:${imgBlock.source.media_type ?? 'image/png'};base64,${imgBlock.source.data}`;
    }
  }
  return undefined;
}

describe('getScreenshotUrl', () => {
  it('extracts URL from url-type source', () => {
    const tool: ToolUseDetail = {
      name: 'mcp__playwright__browser_take_screenshot',
      input: { type: 'png' },
      result: [
        {
          type: 'image',
          source: { type: 'url', url: 'https://cdn.example.com/img.png' },
        },
      ],
    };
    expect(getScreenshotUrl(tool)).toBe('https://cdn.example.com/img.png');
  });

  it('constructs data URL from base64 source', () => {
    const tool: ToolUseDetail = {
      name: 'mcp__playwright__browser_take_screenshot',
      input: { type: 'png' },
      result: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: 'abc123',
          },
        },
      ],
    };
    expect(getScreenshotUrl(tool)).toBe('data:image/jpeg;base64,abc123');
  });

  it('defaults to image/png for missing media_type', () => {
    const tool: ToolUseDetail = {
      name: 'mcp__playwright__browser_take_screenshot',
      input: { type: 'png' },
      result: [
        {
          type: 'image',
          source: { type: 'base64', data: 'xyz' },
        },
      ],
    };
    expect(getScreenshotUrl(tool)).toBe('data:image/png;base64,xyz');
  });

  it('returns undefined for string result', () => {
    const tool: ToolUseDetail = {
      name: 'Read',
      input: { file_path: 'test.py' },
      result: 'file contents',
    };
    expect(getScreenshotUrl(tool)).toBeUndefined();
  });

  it('returns undefined for no image blocks', () => {
    const tool: ToolUseDetail = {
      name: 'mcp__playwright__browser_take_screenshot',
      input: { type: 'png' },
      result: [{ type: 'text', text: 'Error taking screenshot' }],
    };
    expect(getScreenshotUrl(tool)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    const tool: ToolUseDetail = {
      name: 'mcp__playwright__browser_take_screenshot',
      input: {},
      result: [],
    };
    expect(getScreenshotUrl(tool)).toBeUndefined();
  });

  it('picks first image block from mixed content', () => {
    const tool: ToolUseDetail = {
      name: 'mcp__playwright__browser_take_screenshot',
      input: {},
      result: [
        { type: 'text', text: 'Screenshot taken' },
        {
          type: 'image',
          source: { type: 'url', url: 'https://example.com/first.png' },
        },
        {
          type: 'image',
          source: { type: 'url', url: 'https://example.com/second.png' },
        },
      ],
    };
    expect(getScreenshotUrl(tool)).toBe('https://example.com/first.png');
  });
});

// ── hasExpansionData (from helpers.ts) ──

function hasExpansionData(tool: ToolUseDetail): boolean {
  if (typeof tool.result === 'string' && tool.result.length > 0) return true;
  if (Array.isArray(tool.result) && tool.result.length > 0) return true;
  if ((tool.name === 'Edit' || tool.name === 'Write') && tool.input) return true;
  return false;
}

describe('hasExpansionData', () => {
  it('true for non-empty string result', () => {
    expect(hasExpansionData({ name: 'Read', input: {}, result: 'content' })).toBe(true);
  });

  it('false for empty string result', () => {
    expect(hasExpansionData({ name: 'Read', input: {}, result: '' })).toBe(false);
  });

  it('true for non-empty content block array', () => {
    expect(
      hasExpansionData({
        name: 'mcp__playwright__browser_take_screenshot',
        input: {},
        result: [{ type: 'image', source: { type: 'url', url: 'x' } }],
      })
    ).toBe(true);
  });

  it('false for empty array result', () => {
    expect(hasExpansionData({ name: 'Bash', input: {}, result: [] })).toBe(false);
  });

  it('true for Edit tool with input (even empty result)', () => {
    expect(
      hasExpansionData({
        name: 'Edit',
        input: { old_string: 'a', new_string: 'b' },
        result: '',
      })
    ).toBe(true);
  });

  it('true for Write tool with input (even empty result)', () => {
    expect(
      hasExpansionData({
        name: 'Write',
        input: { file_path: 'x', content: 'y' },
        result: '',
      })
    ).toBe(true);
  });

  it('false for unknown tool with empty result', () => {
    expect(hasExpansionData({ name: 'Unknown', input: {}, result: '' })).toBe(false);
  });
});

// ── getToolLabel (from activity-line.tsx) ──

function getToolLabel(tool: ToolUseDetail): string | undefined {
  return tool.input?.file_path || tool.input?.command || tool.input?.pattern;
}

describe('getToolLabel', () => {
  it('returns file_path for Read', () => {
    expect(getToolLabel({ name: 'Read', input: { file_path: 'src/main.py' }, result: '' })).toBe(
      'src/main.py'
    );
  });

  it('returns command for Bash', () => {
    expect(getToolLabel({ name: 'Bash', input: { command: 'npm test' }, result: '' })).toBe(
      'npm test'
    );
  });

  it('returns pattern for Grep', () => {
    expect(getToolLabel({ name: 'Grep', input: { pattern: 'TODO' }, result: '' })).toBe('TODO');
  });

  it('returns undefined for tool with no relevant input', () => {
    expect(
      getToolLabel({
        name: 'mcp__custom__tool',
        input: { arg: 'value' },
        result: '',
      })
    ).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    expect(getToolLabel({ name: 'Read', input: {}, result: '' })).toBeUndefined();
  });

  it('prioritizes file_path over command', () => {
    expect(
      getToolLabel({
        name: 'Read',
        input: { file_path: 'a.py', command: 'cat a.py' },
        result: '',
      })
    ).toBe('a.py');
  });
});

// ── adaptTool (from feed-adapter.ts) ──

function adaptTool(t: { name: string; input: any; result: any; isError?: boolean }): ToolUseDetail {
  return {
    name: t.name,
    input: t.input ?? {},
    result: t.result ?? '',
    isError: t.isError ?? false,
  };
}

describe('adaptTool', () => {
  it('passes through all fields', () => {
    const adapted = adaptTool({
      name: 'Read',
      input: { file_path: 'test.py' },
      result: 'content',
      isError: false,
    });
    expect(adapted.name).toBe('Read');
    expect(adapted.input.file_path).toBe('test.py');
    expect(adapted.result).toBe('content');
    expect(adapted.isError).toBe(false);
  });

  it('handles null input', () => {
    const adapted = adaptTool({ name: 'Read', input: null, result: 'x' });
    expect(adapted.input).toEqual({});
  });

  it('handles null result', () => {
    const adapted = adaptTool({ name: 'Read', input: {}, result: null });
    expect(adapted.result).toBe('');
  });

  it('defaults isError to false', () => {
    const adapted = adaptTool({ name: 'Read', input: {}, result: '' });
    expect(adapted.isError).toBe(false);
  });

  it('preserves content block array result', () => {
    const blocks = [
      { type: 'image', source: { type: 'url', url: 'https://example.com/img.png' } },
    ];
    const adapted = adaptTool({
      name: 'mcp__playwright__browser_take_screenshot',
      input: { type: 'png' },
      result: blocks,
    });
    expect(Array.isArray(adapted.result)).toBe(true);
    const block = (adapted.result as any[])[0];
    expect(block.source.url).toBe('https://example.com/img.png');
  });
});
