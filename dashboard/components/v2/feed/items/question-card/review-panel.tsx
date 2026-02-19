'use client';

import { ChevronRight } from 'lucide-react';
import type { AgentQuestion, QuestionAnswer } from '@/lib/mock-v2-data';

interface ReviewPanelProps {
  questions: AgentQuestion[];
  answers: (QuestionAnswer | undefined)[];
  answerLabel: (qIdx: number) => string;
  agentColor: string;
  submitted: boolean;
  allAnswered: boolean;
  onTabChange: (idx: number) => void;
  onSubmit: () => void;
}

export function ReviewPanel({
  questions,
  answers,
  answerLabel,
  agentColor,
  submitted,
  allAnswered,
  onTabChange,
  onSubmit,
}: ReviewPanelProps) {
  return (
    <div className="px-2 pt-1.5 pb-2">
      <div className="space-y-1.5">
        {questions.map((rq, i) => {
          const a = answers[i];
          const hasA =
            a !== undefined &&
            ((a.selectedIndices.length ?? 0) > 0 || !!a.otherText);

          return (
            <button
              key={i}
              onClick={() => !submitted && onTabChange(i)}
              className="w-full text-left px-2 py-1.5 rounded-sm transition-all duration-150 flex items-start gap-2"
              style={{
                background: hasA
                  ? `color-mix(in srgb, ${agentColor} 6%, transparent)`
                  : 'color-mix(in srgb, var(--foreground) 2%, transparent)',
                border: hasA
                  ? `1px solid color-mix(in srgb, ${agentColor} 20%, transparent)`
                  : '1px solid color-mix(in srgb, var(--foreground) 6%, transparent)',
                cursor: submitted ? 'default' : 'pointer',
              }}
            >
              <div className="flex-1 min-w-0">
                <span
                  className="text-[8px] font-mono font-bold uppercase tracking-widest block mb-0.5"
                  style={{ color: agentColor, opacity: 0.7 }}
                >
                  {rq.header}
                </span>
                <span
                  className="text-[10px] font-mono block truncate"
                  style={{
                    color: hasA ? agentColor : 'var(--muted-foreground)',
                    opacity: hasA ? 1 : 0.5,
                  }}
                >
                  {hasA ? answerLabel(i) : 'No answer yet'}
                </span>
              </div>
              {!submitted && (
                <ChevronRight
                  className="w-3 h-3 flex-shrink-0 mt-1"
                  style={{ color: 'var(--muted-foreground)', opacity: 0.4 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {!submitted && (
        <button
          onClick={onSubmit}
          disabled={!allAnswered}
          className="w-full mt-2 px-3 py-1.5 text-[9px] font-mono font-bold uppercase tracking-widest transition-all duration-200"
          style={{
            color: allAnswered ? 'var(--card)' : 'var(--muted-foreground)',
            background: allAnswered
              ? agentColor
              : 'color-mix(in srgb, var(--foreground) 5%, transparent)',
            borderRadius: '3px',
            cursor: allAnswered ? 'pointer' : 'default',
            opacity: allAnswered ? 1 : 0.4,
          }}
        >
          Submit answers
        </button>
      )}
    </div>
  );
}
