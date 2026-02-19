'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { ToolUseDetail, ContentBlock } from '@/lib/mock-v2-data';
import { MediaLightbox } from './media-lightbox';

interface ToolExpansionProps {
  tool: ToolUseDetail;
  agentColor: string;
  agentName: string;
}

/** Normalize result to ContentBlock[] — wraps string as [{type:"text", text}] */
export function normalizeResult(result: string | ContentBlock[]): ContentBlock[] {
  if (typeof result === 'string') {
    return result.length > 0 ? [{ type: 'text', text: result }] : [];
  }
  if (Array.isArray(result)) return result;
  return [];
}

/** Extract text from result (string or ContentBlock[]) */
export function resultAsString(result: string | ContentBlock[]): string {
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    return result
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('\n');
  }
  return '';
}

/** Extract displayable URL from an image ContentBlock */
export function extractImageUrl(block: ContentBlock): string | undefined {
  if (block.type !== 'image') return undefined;
  if (block.source?.url) return block.source.url;
  if (block.source?.data) {
    return `data:${block.source.media_type ?? 'image/png'};base64,${block.source.data}`;
  }
  return undefined;
}

/** Check if a tool has renderable content */
export function hasToolContent(tool: ToolUseDetail): boolean {
  if (normalizeResult(tool.result).length > 0) return true;
  if ((tool.name === 'Edit' || tool.name === 'Write') && tool.input) return true;
  return false;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  lineNumber: number;
  text: string;
}

/** Compute unified diff lines from old/new strings (client-side) */
function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const lines: DiffLine[] = [];
  let lineNum = 1;

  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to produce diff
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
      lineNum++;
    } else if (op.type === 'delete') {
      lines.push({ type: 'remove', lineNumber: lineNum, text: op.text });
      lineNum++;
    } else {
      lines.push({ type: 'add', lineNumber: lineNum, text: op.text });
      lineNum++;
    }
  }

  return lines;
}

/** Compute diff for Write (all-add) */
function computeWriteDiff(content: string): DiffLine[] {
  return content.split('\n').map((line, i) => ({
    type: 'add' as const,
    lineNumber: i + 1,
    text: line,
  }));
}

export function ToolExpansion({ tool, agentColor, agentName }: ToolExpansionProps) {
  const content = (() => {
    switch (tool.name) {
      case 'Edit':
        return <EditDiffView input={tool.input} />;
      case 'Write':
        return <WriteDiffView input={tool.input} />;
      case 'Read':
        return <FilePreview content={resultAsString(tool.result)} />;
      case 'Grep':
        return <GrepResults content={resultAsString(tool.result)} />;
      case 'Bash':
        return (
          <BashOutput
            command={tool.input.command}
            output={resultAsString(tool.result)}
            isError={tool.isError}
          />
        );
      case 'Glob':
        return <FileList content={resultAsString(tool.result)} />;
      default: {
        // Generic block-by-block rendering for unknown/MCP tools
        const blocks = normalizeResult(tool.result);
        if (blocks.length === 0) return null;
        return (
          <GenericBlockRenderer
            blocks={blocks}
            agentColor={agentColor}
            agentName={agentName}
          />
        );
      }
    }
  })();

  if (!content) return null;

  return (
    <div
      className="mt-1 mb-0.5 overflow-hidden"
      style={{
        background: 'color-mix(in srgb, var(--foreground) 2%, var(--card))',
        border: '1px solid var(--border-subtle)',
        borderLeft: `2px solid color-mix(in srgb, ${agentColor} 30%, transparent)`,
        borderRadius: '4px',
        animation: 'panel-fade 0.15s ease-out',
      }}
    >
      <div className="max-h-[200px] overflow-y-auto scrollbar-thin">
        {content}
      </div>
    </div>
  );
}

/** Renders ContentBlock[] inline — text as pre, images as thumbnails with lightbox */
function GenericBlockRenderer({
  blocks,
  agentColor,
  agentName,
}: {
  blocks: ContentBlock[];
  agentColor: string;
  agentName: string;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const textContent = blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('\n');

  const imageUrls = blocks
    .map(extractImageUrl)
    .filter((u): u is string => !!u);

  return (
    <div className="font-mono text-[9px] leading-relaxed p-1 space-y-1">
      {textContent && (
        <pre className="text-muted-foreground/80 whitespace-pre-wrap break-all px-1 max-h-[140px] overflow-y-auto">
          {textContent}
        </pre>
      )}
      {imageUrls.length > 0 && (
        <>
          <div className="flex items-start gap-1.5 flex-wrap py-0.5 px-1">
            {imageUrls.map((url, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex(i);
                }}
                className="screenshot-thumb group relative rounded-sm overflow-hidden flex-shrink-0"
                style={{ width: '200px' }}
              >
                <img
                  src={url}
                  alt={`Image ${i + 1}`}
                  className="w-full h-auto block"
                  loading="lazy"
                />
                {imageUrls.length > 1 && (
                  <span
                    className="absolute bottom-0.5 right-0.5 text-[7px] font-mono px-1 rounded-sm"
                    style={{ background: 'rgba(0,0,0,0.65)', color: agentColor }}
                  >
                    {i + 1}/{imageUrls.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <MediaLightbox
            urls={imageUrls}
            agentColor={agentColor}
            agentName={agentName}
            openIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />
        </>
      )}
    </div>
  );
}

function EditDiffView({ input }: { input: Record<string, any> }) {
  const diff = useMemo(
    () => computeDiff(input.old_string ?? '', input.new_string ?? ''),
    [input.old_string, input.new_string]
  );
  return <DiffView diff={diff} />;
}

function WriteDiffView({ input }: { input: Record<string, any> }) {
  const diff = useMemo(
    () => computeWriteDiff(input.content ?? ''),
    [input.content]
  );
  return <DiffView diff={diff} />;
}

function DiffView({ diff }: { diff: DiffLine[] }) {
  if (diff.length === 0) return <EmptyState text="No changes" />;

  return (
    <div className="font-mono text-[9px] leading-relaxed">
      {diff.map((line, i) => {
        const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
        return (
          <div
            key={i}
            className="flex"
            style={{
              background:
                line.type === 'add'
                  ? 'color-mix(in srgb, #22c55e 8%, transparent)'
                  : line.type === 'remove'
                    ? 'color-mix(in srgb, var(--destructive) 8%, transparent)'
                    : 'transparent',
              borderLeft:
                line.type === 'add'
                  ? '2px solid #22c55e'
                  : line.type === 'remove'
                    ? '2px solid var(--destructive)'
                    : '2px solid transparent',
            }}
          >
            <span
              className="w-8 text-right pr-1.5 flex-shrink-0 select-none tabular-nums"
              style={{ color: 'var(--muted-foreground)', opacity: 0.5 }}
            >
              {line.lineNumber}
            </span>
            <span
              className="flex-shrink-0 w-3 text-center select-none"
              style={{
                color:
                  line.type === 'add'
                    ? '#22c55e'
                    : line.type === 'remove'
                      ? 'var(--destructive)'
                      : 'var(--muted-foreground)',
                opacity: line.type === 'context' ? 0.3 : 0.7,
              }}
            >
              {prefix}
            </span>
            <span
              className="flex-1 whitespace-pre overflow-x-auto pr-2"
              style={{
                color:
                  line.type === 'context'
                    ? 'color-mix(in srgb, var(--muted-foreground) 70%, transparent)'
                    : 'var(--foreground)',
                opacity: line.type === 'context' ? 0.7 : 0.9,
              }}
            >
              {line.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FilePreview({ content }: { content: string }) {
  if (!content) return <EmptyState text="Empty file" />;

  const lines = content.split('\n');
  const shown = lines.slice(0, 12);
  const hasMore = lines.length > 12;

  return (
    <div className="font-mono text-[9px] leading-relaxed">
      {shown.map((line, i) => (
        <div key={i} className="flex" style={{ borderLeft: '2px solid transparent' }}>
          <span
            className="w-8 text-right pr-1.5 flex-shrink-0 select-none tabular-nums"
            style={{ color: 'var(--muted-foreground)', opacity: 0.5 }}
          >
            {i + 1}
          </span>
          <span className="flex-1 whitespace-pre overflow-x-auto pr-2 text-muted-foreground">
            {line}
          </span>
        </div>
      ))}
      {hasMore && (
        <div className="px-2 py-1">
          <span className="text-[8px] font-mono text-muted-foreground/60">
            Showing 12 of {lines.length} lines
          </span>
        </div>
      )}
    </div>
  );
}

function GrepResults({ content }: { content: string }) {
  if (!content) return <EmptyState text="No matches" />;

  // Parse grep-style file:line:text output
  const matches = content
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const parts = line.split(':', 3);
      if (parts.length >= 3) {
        return { file: parts[0], line: parseInt(parts[1], 10) || 0, text: parts[2] };
      }
      return { file: '', line: 0, text: line };
    });

  const shown = matches.slice(0, 6);
  const hasMore = matches.length > 6;

  return (
    <div className="font-mono text-[9px] leading-relaxed p-1">
      {shown.map((match, i) => (
        <div key={i} className="flex items-baseline gap-1.5 px-1 py-0.5">
          <span className="text-muted-foreground/60 flex-shrink-0 truncate max-w-[40%]">
            {match.file}:{match.line}
          </span>
          <span className="text-muted-foreground flex-1 truncate">
            {match.text}
          </span>
        </div>
      ))}
      {hasMore && (
        <div className="px-1 pt-1">
          <span className="text-[8px] text-muted-foreground/60">
            +{matches.length - 6} more matches
          </span>
        </div>
      )}
    </div>
  );
}

function BashOutput({
  command,
  output,
  isError,
}: {
  command?: string;
  output?: string;
  isError?: boolean;
}) {
  return (
    <div className="font-mono text-[9px] leading-relaxed p-1">
      {command && (
        <div className="flex items-center gap-1 px-1 py-0.5 mb-0.5">
          <span style={{ color: 'var(--accent)', opacity: 0.7 }}>$</span>
          <span style={{ color: 'var(--accent)', opacity: 0.7 }}>{command}</span>
        </div>
      )}
      {output && (
        <pre className="text-muted-foreground/80 whitespace-pre-wrap break-all px-1 max-h-[140px] overflow-y-auto">
          {output}
        </pre>
      )}
      {isError != null && (
        <div className="flex items-center gap-1 px-1 pt-1 mt-0.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {!isError ? (
            <CheckCircle2 className="w-2.5 h-2.5" style={{ color: '#22c55e', opacity: 0.7 }} />
          ) : (
            <XCircle className="w-2.5 h-2.5" style={{ color: 'var(--destructive)', opacity: 0.7 }} />
          )}
          <span
            className="text-[8px]"
            style={{ color: !isError ? '#22c55e' : 'var(--destructive)', opacity: 0.6 }}
          >
            {isError ? 'error' : 'ok'}
          </span>
        </div>
      )}
    </div>
  );
}

function FileList({ content }: { content: string }) {
  if (!content) return <EmptyState text="No files" />;

  const files = content.split('\n').filter((f) => f.trim());
  const shown = files.slice(0, 8);
  const hasMore = files.length > 8;

  return (
    <div className="font-mono text-[9px] leading-relaxed p-1">
      {shown.map((file, i) => (
        <div key={i} className="px-1 py-0.5 text-muted-foreground/70">
          {file}
        </div>
      ))}
      {hasMore && (
        <div className="px-1 pt-1">
          <span className="text-[8px] text-muted-foreground/60">
            +{files.length - 8} more files
          </span>
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="px-2 py-2">
      <span className="text-[8px] font-mono text-muted-foreground/50">{text}</span>
    </div>
  );
}
