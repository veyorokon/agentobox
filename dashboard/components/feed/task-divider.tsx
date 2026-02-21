import type { FeedItem } from "@/types"

type TaskDividerProps = {
  item: FeedItem
}

export function TaskDivider({ item }: TaskDividerProps) {
  const isStart = item.kind === "TASK_START"
  const label = isStart
    ? item.taskDividerSubject ?? "New Task"
    : "Task Complete"

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-border-300/20" />
      <span className="text-text-400 text-xs font-medium whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-border-300/20" />
    </div>
  )
}
