import type { AgentStatus } from '@/types';

const STATUS_COLOR_VAR: Record<AgentStatus, string> = {
  deploying: 'var(--agent-deploying)',
  running: 'var(--agent-active)',
  idle: 'var(--agent-active)',
  stopped: 'var(--agent-dead)',
  error: 'var(--agent-blocked)',
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  deploying: 'Deploying',
  running: 'Running',
  idle: 'Idle',
  stopped: 'Stopped',
  error: 'Error',
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
