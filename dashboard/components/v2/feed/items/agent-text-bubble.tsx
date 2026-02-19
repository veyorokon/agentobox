'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { useMemo } from 'react';

interface AgentTextBubbleProps {
  text: string;
  agentName: string;
  agentColor: string;
  isLead: boolean;
}

export function AgentTextBubble({ text, agentName, agentColor, isLead }: AgentTextBubbleProps) {
  const textSize = isLead ? 'text-xs' : 'text-[11px]';
  const hasText = text.trim().length > 0;

  const mdComponents = useMemo<Components>(() => ({
    p: ({ children }) => (
      <p className={`${textSize} font-mono text-foreground leading-normal mb-1.5 last:mb-0`}>
        {children}
      </p>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }) => (
      <em className="italic text-foreground/80">{children}</em>
    ),
    del: ({ children }) => (
      <del className="line-through text-foreground/50">{children}</del>
    ),
    code: ({ children, className }) => {
      // className is set by react-markdown for fenced blocks: "language-xxx"
      const isBlock = className || (typeof children === 'string' && children.includes('\n'));
      if (isBlock) {
        return (
          <code className={`block text-[10px] font-mono text-foreground/80 bg-background/40 px-2 py-1.5 rounded-sm overflow-x-auto whitespace-pre ${className ?? ''}`}>
            {children}
          </code>
        );
      }
      return (
        <code className="text-[10px] font-mono px-1 py-px rounded-sm bg-background/40 text-foreground/90">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="mb-1.5 last:mb-0">{children}</pre>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 transition-colors"
        style={{ color: agentColor }}
      >
        {children}
      </a>
    ),
    ul: ({ children }) => (
      <ul className={`${textSize} font-mono text-foreground list-disc list-inside mb-1.5 last:mb-0`}>
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className={`${textSize} font-mono text-foreground list-decimal list-inside mb-1.5 last:mb-0`}>
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className="leading-normal">{children}</li>
    ),
    h1: ({ children }) => (
      <p className={`${textSize} font-mono font-semibold text-foreground mb-1`}>{children}</p>
    ),
    h2: ({ children }) => (
      <p className={`${textSize} font-mono font-semibold text-foreground mb-1`}>{children}</p>
    ),
    h3: ({ children }) => (
      <p className={`${textSize} font-mono font-semibold text-foreground/90 mb-1`}>{children}</p>
    ),
    blockquote: ({ children }) => (
      <blockquote
        className="pl-2 mb-1.5 last:mb-0"
        style={{ borderLeft: `2px solid color-mix(in srgb, ${agentColor} 40%, transparent)` }}
      >
        {children}
      </blockquote>
    ),
    hr: () => (
      <hr className="border-t border-muted-foreground/20 my-2" />
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto mb-1.5 last:mb-0">
        <table className={`${textSize} font-mono text-foreground border-collapse`}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead
        style={{ borderBottom: `1px solid color-mix(in srgb, ${agentColor} 30%, transparent)` }}
      >
        {children}
      </thead>
    ),
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => (
      <tr
        style={{ borderBottom: '1px solid color-mix(in srgb, var(--muted-foreground) 15%, transparent)' }}
      >
        {children}
      </tr>
    ),
    th: ({ children }) => (
      <th className="text-left font-semibold text-foreground/90 px-2 py-1">{children}</th>
    ),
    td: ({ children }) => (
      <td className="text-left px-2 py-1 text-foreground/80">{children}</td>
    ),
    input: ({ checked, ...props }) => (
      <input
        type="checkbox"
        checked={checked}
        disabled
        className="mr-1.5 accent-current align-middle"
        style={{ accentColor: agentColor }}
        {...props}
      />
    ),
  }), [agentColor, textSize]);

  return (
    <div
      className="flex justify-start"
      style={{ animation: 'msg-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      <div className={isLead ? 'max-w-[90%]' : 'max-w-[80%]'}>
        <div
          data-augmented-ui="tl-clip br-clip border"
          className="px-3 py-2"
          style={{
            '--aug-tl': isLead ? '6px' : '5px',
            '--aug-br': isLead ? '6px' : '5px',
            '--aug-border-all': '1px',
            '--aug-border-bg': `color-mix(in srgb, ${agentColor} ${isLead ? 50 : 35}%, transparent)`,
            background: `color-mix(in srgb, ${agentColor} ${isLead ? 6 : 4}%, var(--card))`,
          } as React.CSSProperties}
        >
          {hasText && (
            <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</Markdown>
          )}
        </div>
      </div>
    </div>
  );
}
