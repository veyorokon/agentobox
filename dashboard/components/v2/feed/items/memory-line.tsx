'use client';

interface MemoryLineProps {
  agentName: string;
  agentColor: string;
  content: string;
}

export function MemoryLine({ agentName, agentColor, content }: MemoryLineProps) {
  const truncated = content.length > 60 ? content.slice(0, 60) + '...' : content;

  return (
    <div
      className="flex items-center gap-2 py-px px-1"
      style={{ animation: 'msg-enter 0.15s ease-out forwards' }}
    >
      <span
        className="text-[9px] flex-shrink-0 leading-none"
        style={{ color: agentColor, opacity: 0.8 }}
      >
        ◆
      </span>
      <span
        className="text-[9px] font-mono font-bold flex-shrink-0"
        style={{ color: agentColor, opacity: 0.8 }}
      >
        {agentName}
      </span>
      <span className="text-[9px] font-mono text-muted-foreground/50 flex-shrink-0">
        saved to memory
      </span>
      <span className="text-[9px] font-mono text-muted-foreground/70 truncate">
        &ldquo;{truncated}&rdquo;
      </span>
    </div>
  );
}
