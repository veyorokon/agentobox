'use client';

interface SystemLineProps {
  text: string;
  agentColor: string;
}

export function SystemLine({ text, agentColor }: SystemLineProps) {
  return (
    <div
      className="flex items-center gap-2 py-px px-1"
      style={{ animation: 'msg-enter 0.15s ease-out forwards' }}
    >
      <span
        className="w-1 h-1 rounded-full flex-shrink-0"
        style={{ background: agentColor, opacity: 0.6 }}
      />
      <span className="text-[9px] font-mono text-muted-foreground/80 truncate">
        {text}
      </span>
    </div>
  );
}
