import type { AgentStatus } from '@/types';

const STATUS_COLOR_VAR: Record<AgentStatus, string> = {
  deploying: 'var(--agent-deploying)',
  working: 'var(--agent-active)',
  conversing: 'var(--agent-conversing)',
  needs_info: 'var(--agent-needs-info)',
  blocked: 'var(--agent-blocked)',
  completed: 'var(--agent-completed)',
  goal_changed: 'var(--agent-goal-changed)',
  dead: 'var(--agent-dead)',
  terminated: 'var(--agent-dead)',
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  deploying: 'Deploying',
  working: 'Working',
  conversing: 'Conversing',
  needs_info: 'Needs Info',
  blocked: 'Blocked',
  completed: 'Completed',
  goal_changed: 'Goal Changed',
  dead: 'Dead',
  terminated: 'Terminated',
};

export { STATUS_COLOR_VAR };

export function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span
      className="text-xs font-semibold uppercase tracking-wide"
      style={{ color: STATUS_COLOR_VAR[status] }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
