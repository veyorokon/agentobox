'use client';

import { useState, useEffect, useRef } from 'react';
import { ImageIcon } from 'lucide-react';
import { ImageFilmstrip } from './image-filmstrip';

interface ImageLineProps {
  urls: string[];
  agentName: string;
  agentColor: string;
  align?: 'left' | 'right';
  forceExpand?: boolean;
}

export function ImageLine({
  urls,
  agentName,
  agentColor,
  align = 'left',
  forceExpand,
}: ImageLineProps) {
  const [open, setOpen] = useState(!!forceExpand);

  // Sync local state when global toggle changes (one-time push)
  const prevForce = useRef(forceExpand);
  useEffect(() => {
    if (forceExpand !== prevForce.current) {
      setOpen(!!forceExpand);
      prevForce.current = forceExpand;
    }
  }, [forceExpand]);

  if (urls.length === 0) return null;

  const expanded = open;
  const label = `${urls.length} image${urls.length !== 1 ? 's' : ''}`;

  return (
    <div
      className="py-0.5 px-1"
      style={{ animation: 'msg-enter 0.2s ease-out forwards' }}
    >
      {/* Summary row */}
      <div
        className={`flex items-center gap-2 cursor-pointer rounded-sm transition-colors${align === 'right' ? ' justify-end' : ''}`}
        style={{ padding: '1px 0' }}
        onClick={() => setOpen((v) => !v)}
      >
        {align === 'left' && (
          <span
            className="w-1 h-1 rounded-full flex-shrink-0"
            style={{ background: agentColor, opacity: 0.8 }}
          />
        )}
        <ImageIcon
          className="w-2.5 h-2.5 flex-shrink-0"
          style={{ color: agentColor, opacity: 0.7 }}
        />
        <span className="text-[9px] font-mono text-muted-foreground/70">
          {label}
        </span>
        <span
          className="text-[8px] font-mono flex-shrink-0 select-none"
          style={{ color: agentColor, opacity: 0.4 }}
        >
          {expanded ? '\u25BE' : '\u25B8'}
        </span>
        {align === 'right' && (
          <span
            className="w-1 h-1 rounded-full flex-shrink-0"
            style={{ background: agentColor, opacity: 0.8 }}
          />
        )}
      </div>

      {/* Filmstrip — expanded via click or Media toggle */}
      {expanded && (
        <div
          className={`${align === 'right' ? 'mr-3 pr-2' : 'ml-3 pl-2'} mt-0.5`}
          style={{
            [align === 'right' ? 'borderRight' : 'borderLeft']:
              `1px solid color-mix(in srgb, ${agentColor} 40%, transparent)`,
          }}
        >
          <ImageFilmstrip
            urls={urls}
            agentColor={agentColor}
            agentName={agentName}
            align={align}
          />
        </div>
      )}
    </div>
  );
}
