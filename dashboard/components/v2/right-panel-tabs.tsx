'use client';

import { useMemo, useEffect } from 'react';
import { useDashboardStore, type RightTab } from '@/stores/dashboard';
import { useFeedStore } from '@/stores/feed';

export { type RightTab } from '@/stores/dashboard';

export function RightPanelTabs() {
  const activeTab = useDashboardStore((s) => s.rightTab);
  const setRightTab = useDashboardStore((s) => s.setRightTab);
  const selectedAgentId = useDashboardStore((s) => s.selectedAgentId);

  const { tasks, events } = useFeedStore((s) => s.timeline);

  // Auto-switch away from screen tab when agent is deselected
  useEffect(() => {
    if (!selectedAgentId && activeTab === 'screen') {
      setRightTab('timeline');
    }
  }, [selectedAgentId, activeTab, setRightTab]);

  const timeRange = useMemo(() => {
    const allMins = [
      ...tasks.map((t) => t.startMinsAgo),
      ...events.map((e) => e.minsAgo),
      45,
    ];
    const span = Math.ceil(Math.max(...allMins) / 5) * 5;
    const fmt = (d: Date) =>
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${fmt(new Date(Date.now() - span * 60_000))} \u2014 ${fmt(new Date())}`;
  }, [tasks, events]);

  const tabs: { key: RightTab; label: string }[] = [
    { key: 'timeline', label: 'Timeline' },
    { key: 'files', label: 'Files' },
    ...(selectedAgentId ? [{ key: 'screen' as RightTab, label: 'Screen' }] : []),
  ];

  return (
    <div className="flex items-center gap-2 py-1.5 flex-shrink-0">
      <div
        className="flex items-center rounded-sm overflow-hidden flex-shrink-0"
        style={{ border: '1px solid color-mix(in srgb, var(--foreground) 8%, transparent)' }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setRightTab(tab.key)}
              className="px-2.5 py-0.5 text-[8px] font-mono font-bold uppercase tracking-widest transition-all"
              style={{
                background: isActive
                  ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                  : 'transparent',
                color: isActive ? 'var(--accent)' : 'var(--muted-foreground)',
                opacity: isActive ? 1 : 0.5,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
      {activeTab === 'timeline' && (
        <span className="text-[9px] font-mono text-muted-foreground/30">
          {timeRange}
        </span>
      )}
    </div>
  );
}
