'use client';

import { memo } from 'react';
import { useDashboardStore } from '@/stores/dashboard';
import { useAgentActions } from '@/hooks/use-agent-actions';
import { formatTime } from './helpers';
import { FeedRow } from './items/feed-row';
import { UserBubble } from './items/user-bubble';
import { AgentTextBubble } from './items/agent-text-bubble';
import { ActivityLine } from './items/activity-line';
import { ErrorBubble } from './items/error-bubble';
import { StatusLine } from './items/status-line';
import { TaskLine } from './items/task-line';
import { SystemLine } from './items/system-line';
import { QuestionCard } from './items/question-card/question-card';
import { MemoryLine } from './items/memory-line';
import { PlanItem } from './items/plan-item';
import { TaskDivider } from './items/task-divider';
import { TeamMessageLine } from './items/team-message-line';
import { ImageLine } from './items/image-line';
import type { FeedItem as FeedItemData } from '@/lib/mock-v2-data';

interface FeedItemProps {
  item: FeedItemData;
  agentColor: string;
  isLead: boolean;
  colorMap?: Record<string, string>;
}

export const FeedItem = memo(function FeedItem({ item, agentColor, isLead, colorMap }: FeedItemProps) {
  const expandText = useDashboardStore((s) => s.expandText);
  const expandImages = useDashboardStore((s) => s.expandImages);
  const { restartAgent, answerQuestion } = useAgentActions();

  const time = formatTime(item.timestamp);

  switch (item.kind) {
    case 'user-message': {
      const userImages = item.imageUrls ?? [];
      const targetIds = item.targetAgentIds ?? [];
      const targetNames = (item.targetName ?? 'all').split(',').map((s) => s.trim());
      const isMulti = targetIds.length > 1;

      const targetAddon = isMulti ? (
        <div className="flex flex-col items-start gap-0">
          {targetIds.length <= 3 ? (
            targetNames.map((name, i) => (
              <span
                key={targetIds[i] ?? i}
                className="text-[8px] font-mono font-bold uppercase tracking-wider whitespace-nowrap leading-tight"
                style={{ color: colorMap?.[targetIds[i]] ?? 'var(--muted-foreground)' }}
              >
                {name}
              </span>
            ))
          ) : (
            <span
              className="text-[8px] font-mono font-bold uppercase tracking-wider whitespace-nowrap"
              style={{ color: 'var(--accent)' }}
            >
              all
            </span>
          )}
        </div>
      ) : (
        <span
          className="text-[8px] font-mono font-bold uppercase tracking-wider whitespace-nowrap"
          style={{ color: targetIds[0] ? (colorMap?.[targetIds[0]] ?? agentColor) : agentColor }}
        >
          {targetNames[0] ?? 'all'}
        </span>
      );

      return (
        <FeedRow time={time} cost={item.cumulativeCostUsd} align="right" rightAddon={targetAddon}>
          <UserBubble text={item.text ?? ''} />
          {userImages.length > 0 && (
            <ImageLine
              urls={userImages}
              agentColor={agentColor}
              agentName="you"
              align="right"
              forceExpand={expandImages}
            />
          )}
        </FeedRow>
      );
    }
    case 'agent-text': {
      const agentImages = item.imageUrls ?? [];
      const agentChip = (
        <span
          className="text-[8px] font-mono font-bold uppercase tracking-wider whitespace-nowrap"
          style={{ color: agentColor }}
        >
          {item.agentName}
        </span>
      );
      return (
        <FeedRow time={time} cost={item.cumulativeCostUsd} leftAddon={agentChip}>
          <AgentTextBubble
            text={item.text ?? ''}
            agentName={item.agentName}
            agentColor={agentColor}
            isLead={isLead}
          />
          {agentImages.length > 0 && (
            <ImageLine
              urls={agentImages}
              agentColor={agentColor}
              agentName={item.agentName}
              forceExpand={expandImages}
            />
          )}
        </FeedRow>
      );
    }
    case 'activity':
      return (
        <FeedRow time={time} cost={item.cumulativeCostUsd}>
          <ActivityLine
            tools={item.tools ?? []}
            agentName={item.agentName}
            agentColor={agentColor}
            expandText={expandText}
            expandImages={expandImages}
          />
        </FeedRow>
      );
    case 'error':
      return (
        <FeedRow time={time} cost={item.cumulativeCostUsd}>
          <ErrorBubble
            errorText={item.errorText ?? 'Unknown error'}
            agentName={item.agentName}
            agentColor={agentColor}
            agentId={item.agentId}
            onRestart={restartAgent}
          />
        </FeedRow>
      );
    case 'status':
      return (
        <FeedRow time={time} cost={item.cumulativeCostUsd}>
          <StatusLine
            agentName={item.agentName}
            agentColor={agentColor}
            toStatus={item.toStatus ?? 'running'}
          />
        </FeedRow>
      );
    case 'task':
      return (
        <FeedRow time={time} cost={item.cumulativeCostUsd}>
          <TaskLine
            agentName={item.agentName}
            agentColor={agentColor}
            summary={item.taskSummary ?? ''}
          />
        </FeedRow>
      );
    case 'system':
      return (
        <FeedRow time={time} cost={item.cumulativeCostUsd}>
          <SystemLine
            text={item.text ?? 'System event'}
            agentName={item.agentName}
            agentColor={agentColor}
          />
        </FeedRow>
      );
    case 'question':
      return (
        <FeedRow time={time} cost={item.cumulativeCostUsd}>
          <QuestionCard
            questions={item.questions ?? []}
            initialAnswers={item.answers}
            agentId={item.agentId}
            toolUseId={item.toolUseId}
            agentName={item.agentName}
            agentColor={agentColor}
            onSubmitAnswer={answerQuestion}
          />
        </FeedRow>
      );
    case 'memory':
      return (
        <FeedRow time={time} cost={item.cumulativeCostUsd}>
          <MemoryLine
            agentName={item.agentName}
            agentColor={agentColor}
            content={item.memoryContent ?? ''}
          />
        </FeedRow>
      );
    case 'plan':
      return (
        <FeedRow time={time} cost={item.cumulativeCostUsd}>
          <PlanItem
            agentName={item.agentName}
            agentColor={agentColor}
            planStatus={item.planStatus ?? 'content'}
            planSummary={item.planSummary ?? ''}
            planSteps={item.planSteps}
          />
        </FeedRow>
      );
    case 'task-start':
      return (
        <TaskDivider
          variant="start"
          subject={item.taskDividerSubject ?? ''}
          agentName={item.agentName}
          agentColor={agentColor}
          time={time}
        />
      );
    case 'task-end':
      return (
        <TaskDivider
          variant="end"
          subject={item.taskDividerSubject ?? ''}
          agentName={item.agentName}
          agentColor={agentColor}
          time={time}
        />
      );
    case 'team-message':
      return (
        <FeedRow time={time} cost={item.cumulativeCostUsd}>
          <TeamMessageLine
            senderName={item.senderName ?? 'unknown'}
            recipientName={item.agentName}
            text={item.text ?? ''}
            agentColor={agentColor}
          />
        </FeedRow>
      );
    default:
      return null;
  }
}, (prev, next) => {
  // Only re-render if the item itself changed (by ID) or agent color/role changed
  return prev.item.id === next.item.id
    && prev.agentColor === next.agentColor
    && prev.isLead === next.isLead
    && prev.colorMap === next.colorMap;
});
