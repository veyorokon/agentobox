import type { ContentBlock, UserEventData } from "@/types"

type UserMessageProps = {
  data: UserEventData
}

export function UserMessage({ data }: UserMessageProps) {
  const content = data.message.content

  // Extract text from content — could be a string or array of content blocks
  let text = ""
  if (typeof content === "string") {
    text = content
  } else if (Array.isArray(content)) {
    text = (content as ContentBlock[])
      .filter((b) => b.type === "text" && "text" in b)
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n")
  }

  if (!text.trim()) return null

  return (
    <div className="flex justify-end py-1">
      <div className="max-w-[80%]">
        <div className="bg-accent-main-000/15 border border-accent-main-000/20 rounded px-3 py-1.5">
          <p className="text-text-100 text-sm whitespace-pre-wrap leading-relaxed">
            {text}
          </p>
        </div>
      </div>
    </div>
  )
}
