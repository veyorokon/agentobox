'use client';

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { QuestionTabBar } from './question-tab-bar';
import { QuestionPanel } from './question-panel';
import { ReviewPanel } from './review-panel';
import type { AgentQuestion, QuestionAnswer } from '@/lib/mock-v2-data';

interface QuestionCardProps {
  questions: AgentQuestion[];
  initialAnswers?: (QuestionAnswer | undefined)[];
  agentId: string;
  toolUseId?: string;
  agentName: string;
  agentColor: string;
  onSubmitAnswer?: (agentId: string, toolUseId: string, answerText: string) => void;
}

export function QuestionCard({ questions, initialAnswers, agentId, toolUseId, agentName, agentColor, onSubmitAnswer }: QuestionCardProps) {
  const [submitted, setSubmitted] = useState(
    () => initialAnswers?.every((a) => a !== undefined) ?? false
  );
  const [answers, setAnswers] = useState<(QuestionAnswer | undefined)[]>(
    () => initialAnswers ?? new Array(questions.length).fill(undefined)
  );
  const [activeTab, setActiveTab] = useState(0);

  const allAnswered = answers.every((a) => a !== undefined);
  const hasTabs = questions.length > 1;
  const REVIEW_TAB = questions.length;
  const isOnReview = hasTabs && activeTab === REVIEW_TAB;

  function handleAnswer(qIdx: number, answer: QuestionAnswer | undefined) {
    setAnswers((prev) => {
      const copy = [...prev];
      copy[qIdx] = answer;
      return copy;
    });
  }

  function autoAdvance(qIdx: number) {
    if (!hasTabs) return;
    const nextUnanswered = answers.findIndex((a, i) => i !== qIdx && a === undefined);
    if (nextUnanswered !== -1) {
      setTimeout(() => setActiveTab(nextUnanswered), 250);
    } else {
      setTimeout(() => setActiveTab(REVIEW_TAB), 250);
    }
  }

  function handleSubmit() {
    if (!allAnswered) return;
    setSubmitted(true);

    // Build answer text from selections and send back to agent
    if (onSubmitAnswer && toolUseId) {
      const answerParts: string[] = [];
      for (let i = 0; i < questions.length; i++) {
        const a = answers[i];
        if (!a) continue;
        if (a.otherText) {
          answerParts.push(a.otherText);
        } else {
          const labels = a.selectedIndices
            .map((idx) => questions[i].options[idx]?.label)
            .filter(Boolean);
          answerParts.push(labels.join(', '));
        }
      }
      onSubmitAnswer(agentId, toolUseId, answerParts.join('\n'));
    }
  }

  function answerLabel(qIdx: number): string {
    const a = answers[qIdx];
    if (!a) return 'Unanswered';
    if (a.otherText) return a.otherText;
    return a.selectedIndices
      .map((i) => questions[qIdx].options[i]?.label)
      .filter(Boolean)
      .join(', ') || 'Unanswered';
  }

  return (
    <div
      className="flex justify-start"
      style={{ animation: 'msg-enter 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      <div className="w-[60%]">
        {/* Header */}
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5"
            style={{
              background: `color-mix(in srgb, ${agentColor} 8%, transparent)`,
              border: `1px solid color-mix(in srgb, ${agentColor} 18%, transparent)`,
              borderRadius: '2px',
            }}
          >
            <HelpCircle
              className="w-2.5 h-2.5 flex-shrink-0"
              style={{ color: submitted ? agentColor : 'var(--accent)' }}
            />
            <span
              className="text-[8px] font-mono font-bold uppercase tracking-wider"
              style={{ color: agentColor }}
            >
              {agentName}
            </span>
          </span>
          {!submitted && (
            <span
              className="text-[8px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5"
              style={{
                color: 'var(--accent)',
                background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                borderRadius: '2px',
                animation: 'border-pulse 2s ease-in-out infinite',
              }}
            >
              Needs reply
            </span>
          )}
          {submitted && (
            <span className="text-[8px] font-mono text-muted-foreground/70">
              answered
            </span>
          )}
        </div>

        {/* Card body */}
        <div
          data-augmented-ui="tl-clip br-clip border"
          className="overflow-hidden"
          style={{
            '--aug-tl': '8px',
            '--aug-br': '8px',
            '--aug-border-all': '1px',
            '--aug-border-bg': submitted
              ? `color-mix(in srgb, ${agentColor} 40%, transparent)`
              : agentColor,
            background: submitted
              ? 'var(--card)'
              : `color-mix(in srgb, ${agentColor} 3%, var(--card))`,
            boxShadow: submitted
              ? 'none'
              : `0 0 12px color-mix(in srgb, ${agentColor} 8%, transparent), inset 0 1px 0 color-mix(in srgb, ${agentColor} 6%, transparent)`,
          } as React.CSSProperties}
        >
          {hasTabs && (
            <QuestionTabBar
              questions={questions}
              answers={answers}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              agentColor={agentColor}
              submitted={submitted}
              reviewTabIndex={REVIEW_TAB}
            />
          )}

          {isOnReview && (
            <ReviewPanel
              questions={questions}
              answers={answers}
              answerLabel={answerLabel}
              agentColor={agentColor}
              submitted={submitted}
              allAnswered={allAnswered}
              onTabChange={setActiveTab}
              onSubmit={handleSubmit}
            />
          )}

          {!isOnReview && questions[activeTab] && (
            <QuestionPanel
              question={questions[activeTab]}
              answer={answers[activeTab] ?? null}
              questionIndex={activeTab}
              agentColor={agentColor}
              submitted={submitted}
              hasTabs={hasTabs}
              onAnswer={(answer) => handleAnswer(activeTab, answer)}
              onAutoAdvance={() => autoAdvance(activeTab)}
              onSubmit={handleSubmit}
            />
          )}
        </div>
      </div>
    </div>
  );
}
