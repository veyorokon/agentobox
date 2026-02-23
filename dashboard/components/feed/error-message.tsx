import { formatDuration, formatCost } from "@/lib/utils"
import type { ResultEventData } from "@/types"

type ErrorMessageProps = {
  data: ResultEventData
}

export function ErrorMessage({ data }: ErrorMessageProps) {
  const cost = data.total_cost_usd ?? 0
  const durationMs = data.duration_ms ?? 0
  const numTurns = data.num_turns ?? 0
  const errorResult = data.result

  return (
    <div className="rounded-r bg-danger-subtle/10 px-3 py-2 border-l-2 border-l-danger">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] font-mono font-medium text-danger">
          session errored
        </span>
        {cost > 0 && (
          <span className="text-[11px] text-muted font-mono">
            {formatCost(cost)}
          </span>
        )}
      </div>

      {errorResult && (
        <p className="text-danger text-sm font-mono whitespace-pre-wrap leading-relaxed mb-1">
          {errorResult}
        </p>
      )}

      <div className="flex items-center gap-3 text-[10px] text-muted font-mono">
        {durationMs > 0 && <span>{formatDuration(durationMs)}</span>}
        {numTurns > 0 && (
          <span>
            {numTurns} turn{numTurns !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  )
}
