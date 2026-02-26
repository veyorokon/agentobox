"use client"

import { cn } from "@/lib/utils"

export function TabBar({
  tabs,
  activeTab,
  onTabChange,
  badges,
}: {
  tabs: { id: string; label: string; icon: React.ReactNode }[]
  activeTab: string
  onTabChange: (id: string) => void
  badges?: Record<string, number>
}) {
  return (
    <div role="tablist" className="h-8 flex items-center gap-1 px-3 border-b border-border-default bg-surface shrink-0">
      {tabs.map((tab) => {
        const badge = badges?.[tab.id] ?? 0
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              activeTab === tab.id
                ? "bg-surface-raised text-default"
                : "text-muted hover:text-secondary hover:bg-surface-raised/30",
            )}
          >
            {tab.icon}
            {tab.label}
            {badge > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] px-0.5 rounded-full bg-danger text-[8px] font-bold text-on-emphasis flex items-center justify-center">
                {badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
