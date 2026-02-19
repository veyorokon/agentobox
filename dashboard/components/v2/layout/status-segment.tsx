interface StatusSegmentProps {
  count: number;
  label: string;
  color: string;
  pulse?: boolean;
}

export function StatusSegment({ count, label, color, pulse }: StatusSegmentProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{
          background: color,
          boxShadow: pulse ? `0 0 6px ${color}` : 'none',
          animation: pulse ? 'border-pulse 2s ease-in-out infinite' : 'none',
        }}
      />
      <span
        className="text-[10px] font-mono font-bold tabular-nums"
        style={{ color }}
      >
        {count}
      </span>
      <span className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}
