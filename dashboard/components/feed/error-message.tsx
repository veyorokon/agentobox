import { AlertCircle } from "lucide-react"
import type { FeedItem } from "@/types"

type ErrorMessageProps = {
  item: FeedItem
}

export function ErrorMessage({ item }: ErrorMessageProps) {
  return (
    <div className="bg-danger-900/20 border border-danger-200/30 rounded-lg px-4 py-3 flex items-start gap-3">
      <AlertCircle size={16} className="text-danger-000 shrink-0 mt-0.5" />
      <p className="text-danger-000 text-sm whitespace-pre-wrap">
        {item.errorText ?? item.text ?? "Unknown error"}
      </p>
    </div>
  )
}
