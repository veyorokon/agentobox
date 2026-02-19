'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import type { AgentQuestion, QuestionAnswer } from '@/lib/mock-v2-data';

interface QuestionPanelProps {
  question: AgentQuestion;
  answer: QuestionAnswer | null;
  questionIndex: number;
  agentColor: string;
  submitted: boolean;
  hasTabs: boolean;
  onAnswer: (answer: QuestionAnswer | undefined) => void;
  onAutoAdvance: () => void;
  onSubmit: () => void;
}

export function QuestionPanel({
  question: q,
  answer,
  questionIndex,
  agentColor,
  submitted,
  hasTabs,
  onAnswer,
  onAutoAdvance,
  onSubmit,
}: QuestionPanelProps) {
  const [otherInput, setOtherInput] = useState('');
  const [showOtherInput, setShowOtherInput] = useState(false);

  const hasAnswer =
    answer != null && (answer.selectedIndices.length > 0 || !!answer.otherText);
  const answeredWithOther = hasAnswer && answer?.otherText;

  function toggleOption(optIdx: number) {
    if (submitted) return;

    if (optIdx === q.options.length) {
      setShowOtherInput((prev) => !prev);
      return;
    }

    if (q.multiSelect) {
      const indices = answer?.selectedIndices ?? [];
      const has = indices.includes(optIdx);
      onAnswer({
        selectedIndices: has
          ? indices.filter((i) => i !== optIdx)
          : [...indices, optIdx],
      });
    } else {
      onAnswer({ selectedIndices: [optIdx] });
      onAutoAdvance();
    }
  }

  function confirmOther() {
    if (submitted) return;
    const text = otherInput.trim();
    if (!text) return;
    onAnswer({ selectedIndices: [], otherText: text });
    setShowOtherInput(false);
  }

  return (
    <div>
      {/* Question text + multi-select hint */}
      <div className="px-2 pt-1.5 pb-1">
        {!hasTabs && (
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[8px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 flex-shrink-0"
              style={{
                color: agentColor,
                background: `color-mix(in srgb, ${agentColor} 10%, transparent)`,
                borderRadius: '2px',
              }}
            >
              {q.header}
            </span>
          </div>
        )}
        <div className="flex items-start gap-2">
          <p className="text-[11px] font-mono text-foreground leading-relaxed flex-1">
            {q.question}
          </p>
          {q.multiSelect && !submitted && (
            <span className="text-[7px] font-mono text-muted-foreground/50 flex-shrink-0 uppercase tracking-widest mt-0.5">
              multi
            </span>
          )}
        </div>
      </div>

      {/* Options */}
      <div className="px-2 pb-1.5 space-y-0.5">
        {q.options.map((opt, i) => {
          const isSelected = answer?.selectedIndices.includes(i) ?? false;
          const dimUnselected = submitted && !isSelected;

          return (
            <button
              key={i}
              onClick={() => toggleOption(i)}
              disabled={submitted}
              className="w-full text-left px-2 py-1 rounded-sm transition-all duration-200 flex items-start gap-1.5"
              style={{
                background: isSelected
                  ? `color-mix(in srgb, ${agentColor} 12%, transparent)`
                  : 'color-mix(in srgb, var(--foreground) 3%, transparent)',
                border: isSelected
                  ? `1px solid color-mix(in srgb, ${agentColor} 30%, transparent)`
                  : '1px solid color-mix(in srgb, var(--foreground) 6%, transparent)',
                opacity: dimUnselected ? 0.35 : 1,
                cursor: submitted ? 'default' : 'pointer',
              }}
            >
              <div
                className="w-3 h-3 flex-shrink-0 flex items-center justify-center mt-px transition-all duration-200"
                style={{
                  borderRadius: q.multiSelect ? '3px' : '50%',
                  border: isSelected
                    ? `2px solid ${agentColor}`
                    : '1.5px solid var(--muted-foreground)',
                  background: isSelected
                    ? `color-mix(in srgb, ${agentColor} 20%, transparent)`
                    : 'transparent',
                  opacity: dimUnselected ? 0.4 : isSelected ? 1 : 0.5,
                }}
              >
                {isSelected && (
                  <Check className="w-2.5 h-2.5" style={{ color: agentColor }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span
                  className="text-[10px] font-mono font-bold block"
                  style={{ color: isSelected ? agentColor : 'var(--foreground)' }}
                >
                  {opt.label}
                </span>
                {opt.description && (
                  <span className="text-[9px] font-mono text-muted-foreground/70 block mt-0.5">
                    {opt.description}
                  </span>
                )}
              </div>
            </button>
          );
        })}

        {/* "Other" option */}
        {!answeredWithOther && !submitted && (
          <button
            onClick={() => toggleOption(q.options.length)}
            className="w-full text-left px-2 py-1 rounded-sm transition-all duration-200 flex items-start gap-1.5"
            style={{
              background: showOtherInput
                ? `color-mix(in srgb, ${agentColor} 6%, transparent)`
                : 'color-mix(in srgb, var(--foreground) 3%, transparent)',
              border: showOtherInput
                ? `1px solid color-mix(in srgb, ${agentColor} 20%, transparent)`
                : '1px solid color-mix(in srgb, var(--foreground) 6%, transparent)',
              cursor: 'pointer',
            }}
          >
            <div
              className="w-3 h-3 flex-shrink-0 flex items-center justify-center mt-px"
              style={{
                borderRadius: q.multiSelect ? '3px' : '50%',
                border: '1.5px dashed var(--muted-foreground)',
                opacity: 0.4,
              }}
            />
            <span className="text-[10px] font-mono text-muted-foreground/70">
              Other...
            </span>
          </button>
        )}

        {/* "Other" answered display */}
        {answeredWithOther && (
          <div
            className="w-full px-2 py-1 rounded-sm flex items-start gap-1.5"
            style={{
              background: `color-mix(in srgb, ${agentColor} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${agentColor} 30%, transparent)`,
              cursor: submitted ? 'default' : 'pointer',
            }}
            onClick={() => {
              if (submitted) return;
              onAnswer(undefined);
              setOtherInput(answer?.otherText ?? '');
              setShowOtherInput(true);
            }}
          >
            <div
              className="w-3 h-3 flex-shrink-0 flex items-center justify-center mt-px"
              style={{
                borderRadius: q.multiSelect ? '3px' : '50%',
                border: `2px solid ${agentColor}`,
                background: `color-mix(in srgb, ${agentColor} 20%, transparent)`,
              }}
            >
              <Check className="w-2.5 h-2.5" style={{ color: agentColor }} />
            </div>
            <span
              className="text-[10px] font-mono font-bold"
              style={{ color: agentColor }}
            >
              {answer?.otherText}
            </span>
          </div>
        )}

        {/* "Other" text input */}
        {showOtherInput && !submitted && (
          <div className="flex items-center gap-2 mt-1">
            <input
              type="text"
              value={otherInput}
              onChange={(e) => setOtherInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmOther();
              }}
              placeholder="Type your answer..."
              className="flex-1 bg-transparent text-foreground font-mono text-[10px] px-2 py-1.5 focus:outline-none placeholder:text-muted-foreground/40"
              style={{
                border: `1px solid color-mix(in srgb, ${agentColor} 25%, transparent)`,
                borderRadius: '3px',
              }}
              autoFocus
            />
            <button
              onClick={confirmOther}
              className="text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-1 rounded-sm transition-colors"
              style={{
                color: agentColor,
                background: `color-mix(in srgb, ${agentColor} 10%, transparent)`,
                border: `1px solid color-mix(in srgb, ${agentColor} 20%, transparent)`,
              }}
            >
              OK
            </button>
          </div>
        )}

        {/* Single-question submit button */}
        {!hasTabs && !submitted && hasAnswer && (
          <button
            onClick={onSubmit}
            className="w-full mt-1.5 px-3 py-1.5 text-[9px] font-mono font-bold uppercase tracking-widest transition-all duration-200"
            style={{
              color: 'var(--card)',
              background: agentColor,
              borderRadius: '3px',
              cursor: 'pointer',
            }}
          >
            Submit
          </button>
        )}
      </div>
    </div>
  );
}
