import { X } from "lucide-react"
import { cn } from "@/lib/utils"

type AttachmentPreviewProps = {
  files: File[]
  onRemove: (index: number) => void
}

function AttachmentPreview({ files, onRemove }: AttachmentPreviewProps) {
  if (files.length === 0) return null

  return (
    <div className="flex gap-2 px-4 py-2">
      {files.map((file, index) => (
        <div
          key={`${file.name}-${index}`}
          className="relative group rounded-lg border border-border-300 bg-bg-000/60 p-2 flex items-center gap-2"
        >
          <span className="text-xs text-text-300 truncate max-w-[120px]">
            {file.name}
          </span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="rounded-full p-0.5 text-text-400 hover:text-text-100 hover:bg-bg-200 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}

export { AttachmentPreview }
export type { AttachmentPreviewProps }
