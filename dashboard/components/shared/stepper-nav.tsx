import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface StepperNavProps {
  current: number
  total: number
  onPrev: () => void
  onNext: () => void
}

export function StepperNav({ current, total, onPrev, onNext }: StepperNavProps) {
  if (total <= 1) return null
  const hasPrev = current > 0
  const hasNext = current < total - 1

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={!hasPrev}
        onClick={onPrev}
        className={cn(
          "p-0.5 rounded transition-colors",
          hasPrev ? "text-secondary hover:text-default hover:bg-surface-raised/50" : "text-muted/30 cursor-default",
        )}
      >
        <ChevronLeft className="h-3 w-3" />
      </button>
      <span className="text-[10px] text-muted tabular-nums font-mono">
        {current + 1}/{total}
      </span>
      <button
        type="button"
        disabled={!hasNext}
        onClick={onNext}
        className={cn(
          "p-0.5 rounded transition-colors",
          hasNext ? "text-secondary hover:text-default hover:bg-surface-raised/50" : "text-muted/30 cursor-default",
        )}
      >
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  )
}
