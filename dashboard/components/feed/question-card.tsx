"use client"

import { useState } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { AgentAvatar, ChatAvatar } from "@/components/agent/avatar"

export interface QuestionCardProps {
  agent: string
  question: string
  options: string[]
}

export interface MultiQuestionCardProps {
  agent: string
  questions: { text: string; options: string[] }[]
}

/** AskUserQuestion card -- interactive question with options */
export function QuestionCard({
  agent,
  question,
  options,
}: QuestionCardProps) {
  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="group/msg flex gap-2 min-w-0">
      <ChatAvatar name={agent} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted font-mono mb-0.5">{agent}</div>
        <div className="rounded-lg border border-border-default bg-surface-raised/60 p-3 max-w-lg">
          <p className="text-sm text-default mb-3">{question}</p>
          <div className="flex flex-wrap gap-2">
            {options.map((opt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelected(i)}
                className={cn(
                  "px-3 py-1.5 rounded-md border text-xs font-medium transition-all",
                  selected === i
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border-default text-secondary hover:border-border-strong hover:bg-surface-sunken/40",
                )}
              >
                {opt}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted/50 mt-2 font-mono">
            or type a custom response...
          </p>
        </div>
      </div>
    </div>
  )
}

/** Tabbed multi-question card */
export function MultiQuestionCard({
  agent,
  questions,
}: MultiQuestionCardProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [reviewing, setReviewing] = useState(false)

  if (submitted) {
    return (
      <div className="flex items-center gap-2 py-0.5 justify-center">
        <AgentAvatar name={agent} size="sm" />
        <span className="text-[10px] font-mono text-success">
          Answered {questions.length} questions <Check className="inline h-3 w-3" strokeWidth={2.5} />
        </span>
      </div>
    )
  }

  if (reviewing) {
    return (
      <div className="flex gap-2 min-w-0">
        <ChatAvatar name={agent} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-muted font-mono mb-0.5">{agent}</div>
          <div className="rounded-lg border border-border-default bg-surface-raised/60 p-3 max-w-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-default">Review answers</span>
            </div>
            <div className="space-y-2 mb-3">
              {questions.map((q, i) => (
                <div key={i} className="text-xs">
                  <p className="text-muted mb-0.5">{q.text}</p>
                  <p className="text-default font-medium">
                    {answers[i] !== undefined ? q.options[answers[i]] : <span className="text-warning">unanswered</span>}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-border-subtle">
              <button
                type="button"
                onClick={() => { setReviewing(false); setCurrentStep(0) }}
                className="px-3 py-1.5 rounded-md border border-border-default text-xs font-medium text-secondary hover:bg-surface-sunken/40 transition-colors"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setSubmitted(true)}
                className="px-3 py-1.5 rounded-md bg-accent text-on-emphasis text-xs font-medium hover:bg-accent-hover transition-colors"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const q = questions[currentStep]
  const isLast = currentStep === questions.length - 1

  return (
    <div className="flex gap-2 min-w-0">
      <ChatAvatar name={agent} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted font-mono mb-0.5">{agent}</div>
        <div className="rounded-lg border border-border-default bg-surface-raised/60 p-3 max-w-lg">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-default">{q.text}</p>
            <span className="text-[10px] text-muted font-mono shrink-0 ml-2">
              {currentStep + 1} of {questions.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {q.options.map((opt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setAnswers((prev) => ({ ...prev, [currentStep]: i }))}
                className={cn(
                  "px-3 py-1.5 rounded-md border text-xs font-medium transition-all",
                  answers[currentStep] === i
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border-default text-secondary hover:border-border-strong hover:bg-surface-sunken/40",
                )}
              >
                {opt}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-2 border-t border-border-subtle">
            {currentStep > 0 && (
              <button
                type="button"
                onClick={() => setCurrentStep((s) => s - 1)}
                className="px-3 py-1.5 rounded-md border border-border-default text-xs font-medium text-secondary hover:bg-surface-sunken/40 transition-colors"
              >
                Back
              </button>
            )}
            <span className="flex-1" />
            {isLast ? (
              <button
                type="button"
                onClick={() => setReviewing(true)}
                className="px-3 py-1.5 rounded-md bg-accent text-on-emphasis text-xs font-medium hover:bg-accent-hover transition-colors"
              >
                Review & Submit
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCurrentStep((s) => s + 1)}
                className="px-3 py-1.5 rounded-md border border-accent/30 text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
