/**
 * Adapter: GraphQL FeedItemType → MockFeedItem shape.
 *
 * Zero component changes required — all v2 components consume MockFeedItem.
 * This module maps the real GraphQL response into that exact shape.
 */

import type {
  MockFeedItem,
  FeedItemKind,
  ToolUseDetail,
  AgentQuestion,
  QuestionAnswer,
  TimelineTask,
  TimelineEvent,
  TimelineEventKind,
} from '@/lib/mock-v2-data';
import type { AgentStatus } from '@/types';

// ── GraphQL response types (matches PROJECT_FEED_QUERY shape) ──

interface GqlToolUseItem {
  name: string;
  input: Record<string, any>;
  result: any;  // string or ContentBlock[]
  isError?: boolean;
}

interface GqlQuestionOption {
  label: string;
  description: string;
}

interface GqlAgentQuestion {
  question: string;
  header: string;
  options: GqlQuestionOption[];
  multiSelect: boolean;
}

interface GqlQuestionAnswer {
  selectedIndices: number[];
  otherText?: string | null;
}

export interface GqlFeedItem {
  id: string;
  kind: string;
  agentId: string;
  agentName: string;
  timestamp: string;
  text?: string | null;
  imageUrls?: string[] | null;
  targetName?: string | null;
  targetAgentIds?: string[] | null;
  tools?: GqlToolUseItem[] | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  taskSummary?: string | null;
  errorText?: string | null;
  cumulativeCostUsd?: number | null;
  questions?: GqlAgentQuestion[] | null;
  answers?: (GqlQuestionAnswer | null)[] | null;
  toolUseId?: string | null;
  memoryContent?: string | null;
  planStatus?: string | null;
  planSummary?: string | null;
  planSteps?: string[] | null;
  taskDividerSubject?: string | null;
  taskDividerId?: string | null;
  taskDividerActiveForm?: string | null;
  senderName?: string | null;
}

// ── Kind mapping ──

const KIND_MAP: Record<string, FeedItemKind> = {
  USER_MESSAGE: 'user-message',
  AGENT_TEXT: 'agent-text',
  ACTIVITY: 'activity',
  STATUS: 'status',
  TASK: 'task',
  SYSTEM: 'system',
  ERROR: 'error',
  QUESTION: 'question',
  MEMORY: 'memory',
  PLAN: 'plan',
  TASK_START: 'task-start',
  TASK_END: 'task-end',
  TEAM_MESSAGE: 'team-message',
};

// ── Adapters ──

function adaptTool(t: GqlToolUseItem): ToolUseDetail {
  return {
    name: t.name,
    input: t.input ?? {},
    result: t.result ?? '',
    isError: t.isError ?? false,
  };
}

function adaptAnswer(a: GqlQuestionAnswer): QuestionAnswer {
  return {
    selectedIndices: a.selectedIndices,
    otherText: a.otherText ?? undefined,
  };
}

function adaptQuestion(q: GqlAgentQuestion): AgentQuestion {
  return {
    question: q.question,
    header: q.header,
    options: q.options.map((o) => ({ label: o.label, description: o.description })),
    multiSelect: q.multiSelect,
  };
}

function minsAgoFromTimestamp(ts: string): number {
  return Math.max(0, (Date.now() - new Date(ts).getTime()) / 60_000);
}

/**
 * Adapt a single GraphQL FeedItem to MockFeedItem shape.
 */
export function adaptFeedItem(item: GqlFeedItem): MockFeedItem {
  return {
    id: item.id,
    kind: KIND_MAP[item.kind] ?? ('system' as FeedItemKind),
    agentId: item.agentId,
    agentName: item.agentName,
    minsAgo: minsAgoFromTimestamp(item.timestamp),
    timestamp: item.timestamp,
    text: item.text ?? undefined,
    imageUrls: item.imageUrls ?? undefined,
    targetName: item.targetName ?? undefined,
    targetAgentIds: item.targetAgentIds ?? undefined,
    tools: item.tools?.map(adaptTool),
    fromStatus: (item.fromStatus as AgentStatus) ?? undefined,
    toStatus: (item.toStatus as AgentStatus) ?? undefined,
    taskSummary: item.taskSummary ?? undefined,
    errorText: item.errorText ?? undefined,
    cumulativeCostUsd: item.cumulativeCostUsd ?? undefined,
    questions: item.questions?.map(adaptQuestion),
    answers: item.answers?.map((a) => a ? adaptAnswer(a) : undefined),
    toolUseId: item.toolUseId ?? undefined,
    memoryContent: item.memoryContent ?? undefined,
    planStatus: (item.planStatus as MockFeedItem['planStatus']) ?? undefined,
    planSummary: item.planSummary ?? undefined,
    planSteps: item.planSteps ?? undefined,
    taskDividerSubject: item.taskDividerSubject ?? undefined,
    taskDividerId: item.taskDividerId ?? undefined,
    taskDividerActiveForm: item.taskDividerActiveForm ?? undefined,
    senderName: item.senderName ?? undefined,
  };
}

/**
 * Adapt an array of GraphQL feed items. Returns items sorted oldest-first
 * (matching mock data convention — largest minsAgo first).
 */
export function adaptFeedItems(items: GqlFeedItem[]): MockFeedItem[] {
  return items.map(adaptFeedItem);
  // GraphQL already returns sorted by timestamp (oldest first from feed_transform)
}

/**
 * Derive TimelineTask[] and TimelineEvent[] from adapted feed items.
 *
 * Replaces generateTimelineTasks() / generateTimelineEvents() for live data.
 *
 * - task-start → open task (in_progress)
 * - task-end with matching taskDividerId → closes the task (completed)
 * - status items → timeline events
 * - error items → timeline events
 * - user-message items → timeline events
 */
export function adaptFeedToTimeline(items: MockFeedItem[]): {
  tasks: TimelineTask[];
  events: TimelineEvent[];
} {
  const taskMap = new Map<string, TimelineTask>();
  const events: TimelineEvent[] = [];
  let taskCounter = 0;
  let eventCounter = 0;

  for (const item of items) {
    switch (item.kind) {
      case 'task-start':
        if (item.taskDividerId) {
          taskMap.set(item.taskDividerId, {
            id: `tt-${++taskCounter}`,
            agentId: item.agentId,
            agentName: item.agentName,
            subject: item.taskDividerSubject ?? 'Task',
            activeForm: item.taskDividerActiveForm ?? item.taskDividerSubject ?? 'Working',
            startMinsAgo: item.minsAgo,
            status: 'in_progress',
          });
        }
        break;

      case 'task-end':
        if (item.taskDividerId && taskMap.has(item.taskDividerId)) {
          const task = taskMap.get(item.taskDividerId)!;
          task.endMinsAgo = item.minsAgo;
          task.status = 'completed';
        }
        break;

      case 'status':
        events.push({
          id: `te-${++eventCounter}`,
          agentId: item.agentId,
          agentName: item.agentName,
          kind: 'status' as TimelineEventKind,
          minsAgo: item.minsAgo,
          summary: item.toStatus
            ? `${item.fromStatus} → ${item.toStatus}`
            : 'Status change',
        });
        break;

      case 'error':
        events.push({
          id: `te-${++eventCounter}`,
          agentId: item.agentId,
          agentName: item.agentName,
          kind: 'error' as TimelineEventKind,
          minsAgo: item.minsAgo,
          summary: item.errorText?.split('\n')[0] ?? 'Error',
        });
        break;

      case 'user-message':
        events.push({
          id: `te-${++eventCounter}`,
          agentId: item.agentId,
          agentName: item.agentName,
          kind: 'message' as TimelineEventKind,
          minsAgo: item.minsAgo,
          summary: `User: ${(item.text ?? '').slice(0, 50)}`,
        });
        break;

      case 'team-message':
        events.push({
          id: `te-${++eventCounter}`,
          agentId: item.agentId,
          agentName: item.agentName,
          kind: 'message' as TimelineEventKind,
          minsAgo: item.minsAgo,
          summary: `${item.senderName ?? '?'}: ${(item.text ?? '').slice(0, 50)}`,
        });
        break;
    }
  }

  return {
    tasks: Array.from(taskMap.values()),
    events,
  };
}
