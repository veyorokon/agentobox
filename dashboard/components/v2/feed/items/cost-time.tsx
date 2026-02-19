'use client';

/**
 * Metadata line for feed items.
 *
 * align="left"  (agent-side):  time  cost  — time on outer/left edge
 * align="right" (user-side):   cost  time  — time on outer/right edge
 */
export function CostTime({
  cost,
  time,
  align = 'left',
}: {
  cost?: number;
  time: string;
  align?: 'left' | 'right';
}) {
  const hasCost = cost != null && cost > 0;
  const costSpan = hasCost && (
    <span className="text-muted-foreground/40">${cost.toFixed(2)}</span>
  );

  return (
    <span className="text-[8px] font-mono text-muted-foreground/70 flex-shrink-0 tabular-nums flex items-center gap-1.5">
      {align === 'left' ? (
        <>
          {time}
          {costSpan}
        </>
      ) : (
        <>
          {costSpan}
          {time}
        </>
      )}
    </span>
  );
}
