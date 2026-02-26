"use client"

export function PanelHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-8 px-3 flex items-center border-b border-border-default shrink-0">
      {children}
    </div>
  )
}
