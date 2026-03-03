/**
 * Instant loading UI shown during navigation to a project page.
 *
 * Next.js app router renders this immediately while the page component
 * and its data load. Skeleton matches the project dashboard layout so
 * the transition feels seamless rather than jarring.
 */

function Pulse({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-raised/60 ${className ?? ""}`} />
}

export default function ProjectLoading() {
  return (
    <div className="h-screen flex bg-surface overflow-hidden">
      {/* Left panel skeleton */}
      <div className="w-[260px] border-r border-border-default bg-surface flex-col hidden md:flex">
        {/* Header */}
        <div className="h-10 px-3 flex items-center border-b border-border-default">
          <Pulse className="h-5 w-24" />
        </div>

        {/* Search bar */}
        <div className="px-3 py-2">
          <Pulse className="h-7 w-full rounded-md" />
        </div>

        {/* Agent cards */}
        <div className="flex-1 px-2 py-1 space-y-1.5">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 px-2 py-2.5 rounded-lg">
              <Pulse className="h-8 w-8 rounded-md shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Pulse className="h-3 w-20" />
                <Pulse className="h-2.5 w-32" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Attention bar placeholder */}
        <div className="h-8 border-b border-border-default px-4 flex items-center">
          <Pulse className="h-3 w-48" />
        </div>

        {/* Feed area */}
        <div className="flex-1 px-4 py-6 space-y-4 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex gap-3">
              <Pulse className="h-6 w-6 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Pulse className="h-3 w-28" />
                <Pulse className="h-12 w-full rounded-md" />
              </div>
            </div>
          ))}
        </div>

        {/* Composer bar */}
        <div className="h-14 border-t border-border-default px-4 flex items-center">
          <Pulse className="h-9 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}
