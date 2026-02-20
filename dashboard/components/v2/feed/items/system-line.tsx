'use client';

interface SystemLineProps {
  text: string;
  agentName: string;
  agentColor: string;
}

export function SystemLine({ text, agentName, agentColor }: SystemLineProps) {
  return (
    <div
      className="flex items-center gap-1.5 py-px px-1"
      style={{ animation: 'msg-enter 0.15s ease-out forwards' }}
    >
      <span
        className="text-[9px] font-mono font-bold flex-shrink-0"
        style={{ color: agentColor, opacity: 0.8 }}
      >
        {agentName}
      </span>
      <span className="text-[9px] font-mono text-muted-foreground/80 truncate">
        {text}
      </span>
    </div>
  );
}
