'use client';

import { useState } from 'react';
import { getAgentColor } from '@/lib/agent-colors';

interface TeamMessageLineProps {
  senderName: string;
  recipientName: string;
  text: string;
  agentColor: string;
}

export function TeamMessageLine({
  senderName,
  recipientName,
  text,
  agentColor,
}: TeamMessageLineProps) {
  const [expanded, setExpanded] = useState(false);

  const senderColor = getAgentColor(senderName, senderName === 'lead' ? 'lead' : undefined);
  const recipientColor = agentColor;

  const truncated = text.length > 64 ? text.slice(0, 64) + '\u2026' : text;
  const needsExpand = text.length > 64;

  return (
    <div
      className="py-0.5 px-1"
      style={{ animation: 'msg-enter 0.15s ease-out forwards' }}
    >
      {/* Compact summary row */}
      <div
        className="flex items-center gap-1.5 rounded-sm transition-colors"
        style={{
          cursor: needsExpand ? 'pointer' : 'default',
          padding: '1px 0',
        }}
        onClick={() => needsExpand && setExpanded((v) => !v)}
      >
        {/* Sender dot */}
        <span
          className="w-1 h-1 rounded-full flex-shrink-0"
          style={{ background: senderColor, opacity: 0.8 }}
        />

        {/* sender -> recipient */}
        <span
          className="text-[9px] font-mono font-bold flex-shrink-0"
          style={{ color: senderColor, opacity: 0.9 }}
        >
          {senderName}
        </span>
        <span
          className="text-[9px] flex-shrink-0"
          style={{ color: 'var(--muted-foreground)', opacity: 0.4 }}
        >
          &rarr;
        </span>
        <span
          className="text-[9px] font-mono font-bold flex-shrink-0"
          style={{ color: recipientColor, opacity: 0.9 }}
        >
          {recipientName}
        </span>

        {/* Truncated message preview */}
        {!expanded && (
          <span className="text-[9px] font-mono text-muted-foreground/60 truncate">
            &ldquo;{truncated}&rdquo;
          </span>
        )}

        {/* Expand indicator */}
        {needsExpand && (
          <span
            className="text-[8px] font-mono flex-shrink-0 select-none"
            style={{ color: senderColor, opacity: 0.4 }}
          >
            {expanded ? '\u25BE' : '\u25B8'}
          </span>
        )}
      </div>

      {/* Expanded message content */}
      {expanded && (
        <div
          className="ml-3 pl-2 mt-0.5 mb-0.5"
          style={{
            borderLeft: `1px solid color-mix(in srgb, ${senderColor} 40%, transparent)`,
          }}
        >
          <p
            className="text-[10px] font-mono leading-relaxed whitespace-pre-wrap"
            style={{ color: 'var(--foreground)', opacity: 0.85 }}
          >
            {text}
          </p>
        </div>
      )}
    </div>
  );
}
