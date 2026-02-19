'use client';

import { CostTime } from './cost-time';

interface FeedRowProps {
  time: string;
  cost?: number;
  align?: 'left' | 'right';
  leftAddon?: React.ReactNode;
  rightAddon?: React.ReactNode;
  children: React.ReactNode;
}

export function FeedRow({ time, cost, align = 'left', leftAddon, rightAddon, children }: FeedRowProps) {
  return (
    <div
      className="grid items-start py-0.5"
      style={{ gridTemplateColumns: '84px 1fr 84px' }}
    >
      {/* Left gutter */}
      <div className={`flex flex-col pr-3${leftAddon ? ' self-stretch' : ''}`}>
        <div className="pt-px flex justify-end">
          {align === 'left' && <CostTime time={time} cost={cost} />}
        </div>
        {leftAddon && (
          <div className="flex-1 flex items-start justify-end pt-1">
            {leftAddon}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0">{children}</div>

      {/* Right gutter */}
      <div className={`flex flex-col pl-3${rightAddon ? ' self-stretch' : ''}`}>
        <div className="pt-px flex justify-start">
          {align === 'right' && <CostTime time={time} cost={cost} align="right" />}
        </div>
        {rightAddon && (
          <div className="flex-1 flex items-start justify-start pt-1">
            {rightAddon}
          </div>
        )}
      </div>
    </div>
  );
}
