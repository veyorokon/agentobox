'use client';

import { Check } from 'lucide-react';
import type { AgentQuestion, QuestionAnswer } from '@/lib/mock-v2-data';

interface QuestionTabBarProps {
  questions: AgentQuestion[];
  answers: (QuestionAnswer | undefined)[];
  activeTab: number;
  onTabChange: (idx: number) => void;
  agentColor: string;
  submitted: boolean;
  reviewTabIndex: number;
}

export function QuestionTabBar({
  questions,
  answers,
  activeTab,
  onTabChange,
  agentColor,
  submitted,
  reviewTabIndex,
}: QuestionTabBarProps) {
  const isOnReview = activeTab === reviewTabIndex;

  return (
    <div
      className="flex"
      style={{
        borderBottom: `1px solid color-mix(in srgb, ${agentColor} 15%, transparent)`,
      }}
    >
      {questions.map((tab, i) => {
        const isActive = activeTab === i;
        const isTabAnswered =
          answers[i] !== undefined &&
          ((answers[i]?.selectedIndices.length ?? 0) > 0 || !!answers[i]?.otherText);

        return (
          <button
            key={i}
            onClick={() => onTabChange(i)}
            className="flex items-center gap-1 px-2 py-1 transition-all duration-150 relative"
            style={{
              background: isActive
                ? `color-mix(in srgb, ${agentColor} 6%, transparent)`
                : 'transparent',
              color: isActive ? agentColor : 'var(--muted-foreground)',
              flex: '1 1 0',
              justifyContent: 'center',
              cursor: submitted ? 'default' : 'pointer',
            }}
          >
            {isTabAnswered && (
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: agentColor }}
              />
            )}
            {!isTabAnswered && !isActive && (
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  border: '1px solid var(--muted-foreground)',
                  opacity: 0.4,
                }}
              />
            )}
            <span
              className="text-[8px] font-mono font-bold uppercase tracking-widest"
              style={{
                color: isActive
                  ? agentColor
                  : isTabAnswered
                    ? agentColor
                    : 'var(--muted-foreground)',
                opacity: isActive ? 1 : isTabAnswered ? 0.7 : 0.5,
              }}
            >
              {tab.header}
            </span>
            {isActive && (
              <div
                className="absolute bottom-0 left-2 right-2 h-px"
                style={{ background: agentColor }}
              />
            )}
          </button>
        );
      })}

      {/* Review tab */}
      <button
        onClick={() => onTabChange(reviewTabIndex)}
        className="flex items-center gap-1 px-2 py-1 transition-all duration-150 relative"
        style={{
          background: isOnReview
            ? `color-mix(in srgb, ${agentColor} 6%, transparent)`
            : 'transparent',
          flex: '1 1 0',
          justifyContent: 'center',
          cursor: submitted ? 'default' : 'pointer',
        }}
      >
        {submitted && (
          <Check
            className="w-2.5 h-2.5 flex-shrink-0"
            style={{ color: agentColor }}
          />
        )}
        <span
          className="text-[8px] font-mono font-bold uppercase tracking-widest"
          style={{
            color: isOnReview ? agentColor : 'var(--muted-foreground)',
            opacity: isOnReview ? 1 : 0.5,
          }}
        >
          Review
        </span>
        {isOnReview && (
          <div
            className="absolute bottom-0 left-2 right-2 h-px"
            style={{ background: agentColor }}
          />
        )}
      </button>
    </div>
  );
}
