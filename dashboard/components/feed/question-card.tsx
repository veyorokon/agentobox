"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { FeedItem, AgentQuestion, QuestionAnswer } from "@/types"

type QuestionCardProps = {
  item: FeedItem
}

function QuestionBlock({
  question,
  answer,
}: {
  question: AgentQuestion
  answer: QuestionAnswer | undefined
}) {
  const isAnswered = answer !== undefined

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-text-100">
        {question.header || question.question}
      </h4>
      {question.header && question.question !== question.header && (
        <p className="text-xs text-text-300">{question.question}</p>
      )}

      <div className="flex flex-col gap-1.5">
        {question.options.map((option, i) => {
          const isSelected = isAnswered && answer.selectedIndices.includes(i)

          return (
            <Button
              key={i}
              variant="secondary"
              size="sm"
              className={cn(
                "w-full justify-start text-left",
                isSelected && "border-accent-main-000 text-accent-main-100",
              )}
              disabled={isAnswered}
            >
              <div>
                <div className="text-sm">{option.label}</div>
                {option.description && (
                  <div className="text-xs text-text-400 font-normal">
                    {option.description}
                  </div>
                )}
              </div>
            </Button>
          )
        })}
      </div>

      {isAnswered && answer.otherText && (
        <p className="text-xs text-text-300 italic mt-1">
          &quot;{answer.otherText}&quot;
        </p>
      )}
    </div>
  )
}

export function QuestionCard({ item }: QuestionCardProps) {
  if (!item.questions || item.questions.length === 0) return null

  return (
    <div className="bg-bg-000 border border-border-300 rounded-xl p-4 space-y-4">
      {item.questions.map((q, i) => (
        <QuestionBlock
          key={i}
          question={q}
          answer={item.answers?.[i]}
        />
      ))}
    </div>
  )
}
