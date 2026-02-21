import { Circle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { FeedItem } from "@/types"

type PlanMessageProps = {
  item: FeedItem
}

export function PlanMessage({ item }: PlanMessageProps) {
  const statusVariant =
    item.planStatus === "completed"
      ? "success"
      : item.planStatus === "failed"
        ? "danger"
        : item.planStatus === "in_progress"
          ? "warning"
          : "default"

  return (
    <div className="bg-bg-000/50 rounded-lg p-3 border border-border-300">
      <div className="flex items-center gap-2 mb-2">
        <Badge variant={statusVariant}>Plan</Badge>
        {item.planStatus && (
          <span className="text-xs text-text-400">{item.planStatus}</span>
        )}
      </div>

      {item.planSummary && (
        <p className="text-sm text-text-200 mb-2">{item.planSummary}</p>
      )}

      {item.planSteps && item.planSteps.length > 0 && (
        <ul className="space-y-1">
          {item.planSteps.map((step, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-text-200">
              <Circle size={14} className="text-text-400 shrink-0" />
              {step}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
