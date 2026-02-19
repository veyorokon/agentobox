'use client';

interface StatusLineProps {
  agentName: string;
  agentColor: string;
  toStatus: string;
}

export function StatusLine({ agentName, agentColor, toStatus }: StatusLineProps) {
  return (
    <div
      className="flex items-center gap-1.5 py-px px-1"
      style={{ animation: 'msg-enter 0.15s ease-out forwards' }}
    >
      <span className="text-[9px] font-mono text-muted-foreground/70 truncate">
        <span style={{ color: agentColor, opacity: 0.8 }}>{agentName}</span>
        {' is now '}
        {toStatus}
      </span>
    </div>
  );
}
