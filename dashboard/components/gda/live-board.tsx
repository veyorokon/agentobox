"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { Activity, ArrowLeft, CheckCircle2, CircleDot, Clock3, Eye, Radar, SquareStack } from "lucide-react"

import { BackendStatusBanner } from "@/components/ui/backend-status-banner"
import { describeGraphqlError } from "@/lib/graphql/errors"
import { type GdaOverview, useProjectGdaOverview } from "@/lib/graphql/hooks/use-gda"
import { cn } from "@/lib/utils"


function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Pending"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}


function renderValue(value: unknown) {
  if (value == null) return "null"
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return JSON.stringify(value)
}

function normalizeOverview(overview: unknown): GdaOverview | null {
  if (!overview || typeof overview !== "object") return null
  const data = overview as Record<string, unknown>
  const objective = typeof data.objective === "object" && data.objective !== null
    ? data.objective as Record<string, unknown>
    : null
  const awareness = typeof data.awareness === "object" && data.awareness !== null
    ? data.awareness as Record<string, unknown>
    : {}
  const progress = typeof data.progress === "object" && data.progress !== null
    ? data.progress as Record<string, unknown>
    : {}
  const goalProgress = Array.isArray(progress.goalProgress) ? progress.goalProgress : []
  const activeCommitments = Array.isArray(data.activeCommitments) ? data.activeCommitments : []
  const recentObservations = Array.isArray(data.recentObservations) ? data.recentObservations : []
  const recentExecutions = Array.isArray(data.recentExecutions) ? data.recentExecutions : []
  const stateEntries = Array.isArray(data.stateEntries) ? data.stateEntries : []

  return {
    contextVersionId: typeof data.contextVersionId === "string" ? data.contextVersionId : "",
    subjectRef: typeof data.subjectRef === "string" ? data.subjectRef : "",
    subjectName: typeof data.subjectName === "string" ? data.subjectName : "",
    worldRef: typeof data.worldRef === "string" ? data.worldRef : "",
    objective: objective
      ? {
          objectiveId: typeof objective.objectiveId === "string" ? objective.objectiveId : "",
          name: typeof objective.name === "string" ? objective.name : "",
          description: typeof objective.description === "string" ? objective.description : "",
        }
      : null,
    awareness: {
      controlStatus: typeof awareness.controlStatus === "string" ? awareness.controlStatus : "",
      stateEntryCount: typeof awareness.stateEntryCount === "number" ? awareness.stateEntryCount : 0,
      activeCommitmentCount: typeof awareness.activeCommitmentCount === "number" ? awareness.activeCommitmentCount : 0,
      recentObservationCount: typeof awareness.recentObservationCount === "number" ? awareness.recentObservationCount : 0,
      lastObservedAt: typeof awareness.lastObservedAt === "string" ? awareness.lastObservedAt : null,
    },
    progress: {
      objectiveId: typeof progress.objectiveId === "string" ? progress.objectiveId : "",
      status: typeof progress.status === "string" ? progress.status : "idle",
      totalGoals: typeof progress.totalGoals === "number" ? progress.totalGoals : 0,
      satisfiedGoals: typeof progress.satisfiedGoals === "number" ? progress.satisfiedGoals : 0,
      unknownGoals: typeof progress.unknownGoals === "number" ? progress.unknownGoals : 0,
      failedGoals: typeof progress.failedGoals === "number" ? progress.failedGoals : 0,
      goalProgress: goalProgress.map((goal) => {
        const item = typeof goal === "object" && goal !== null ? goal as Record<string, unknown> : {}
        return {
          goalId: typeof item.goalId === "string" ? item.goalId : "",
          goalName: typeof item.goalName === "string" ? item.goalName : "",
          status: typeof item.status === "string" ? item.status : "unknown",
          missingDimensions: Array.isArray(item.missingDimensions) ? item.missingDimensions.filter((v): v is string => typeof v === "string") : [],
          failedDimensions: Array.isArray(item.failedDimensions) ? item.failedDimensions.filter((v): v is string => typeof v === "string") : [],
        }
      }),
    },
    activeCommitments: activeCommitments.map((commitment) => {
      const item = typeof commitment === "object" && commitment !== null ? commitment as Record<string, unknown> : {}
      return {
        commitmentId: typeof item.commitmentId === "string" ? item.commitmentId : "",
        capabilityId: typeof item.capabilityId === "string" ? item.capabilityId : "",
        status: typeof item.status === "string" ? item.status : "",
        objectiveId: typeof item.objectiveId === "string" ? item.objectiveId : "",
        assignmentAgentRef: typeof item.assignmentAgentRef === "string" ? item.assignmentAgentRef : null,
        assignmentAgentName: typeof item.assignmentAgentName === "string" ? item.assignmentAgentName : null,
      }
    }),
    recentObservations: recentObservations.map((observation) => {
      const item = typeof observation === "object" && observation !== null ? observation as Record<string, unknown> : {}
      return {
        observationId: typeof item.observationId === "string" ? item.observationId : "",
        kind: typeof item.kind === "string" ? item.kind : "",
        subject: typeof item.subject === "string" ? item.subject : "",
        observedAt: typeof item.observedAt === "string" ? item.observedAt : null,
        sourceKind: typeof item.sourceKind === "string" ? item.sourceKind : "",
        sourceId: typeof item.sourceId === "string" ? item.sourceId : "",
        quality: typeof item.quality === "string" ? item.quality : "",
      }
    }),
    recentExecutions: recentExecutions.map((execution) => {
      const item = typeof execution === "object" && execution !== null ? execution as Record<string, unknown> : {}
      return {
        invocationId: typeof item.invocationId === "string" ? item.invocationId : "",
        status: typeof item.status === "string" ? item.status : "",
        commitmentId: typeof item.commitmentId === "string" ? item.commitmentId : null,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : null,
        completedAt: typeof item.completedAt === "string" ? item.completedAt : null,
      }
    }),
    stateEntries: stateEntries.map((entry) => {
      const item = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {}
      return {
        dimensionId: typeof item.dimensionId === "string" ? item.dimensionId : "",
        value: item.value,
        schemaRef: typeof item.schemaRef === "string" ? item.schemaRef : "",
        origin: typeof item.origin === "string" ? item.origin : "",
        validFrom: typeof item.validFrom === "string" ? item.validFrom : null,
        validUntil: typeof item.validUntil === "string" ? item.validUntil : null,
      }
    }),
  }
}


function statusTone(status: string) {
  switch (status) {
    case "satisfied":
    case "ok":
    case "running":
    case "active":
      return "text-success border-success/30 bg-success/8"
    case "unknown":
    case "idle":
      return "text-warning border-warning/30 bg-warning/8"
    case "unsatisfied":
    case "failed":
    case "canceled":
      return "text-danger border-danger/30 bg-danger/8"
    default:
      return "text-secondary border-border-default bg-surface-raised"
  }
}


function SectionCard({
  title,
  icon,
  eyebrow,
  children,
}: {
  title: string
  icon: React.ReactNode
  eyebrow?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border-default bg-surface shadow-sm overflow-hidden">
      <header className="px-4 py-3 border-b border-border-subtle bg-surface-raised/70">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
            {icon}
          </div>
          <div className="min-w-0">
            {eyebrow && <div className="text-[10px] uppercase tracking-[0.18em] text-muted">{eyebrow}</div>}
            <h2 className="text-sm font-semibold text-default">{title}</h2>
          </div>
        </div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}


export function GdaLiveBoard({ projectId }: { projectId: string }) {
  const { data, loading, error, refetch } = useProjectGdaOverview(projectId)
  const project = data?.project
  const currentOverview = useMemo(() => normalizeOverview(project?.gdaOverview), [project?.gdaOverview])
  const [stableProjectName, setStableProjectName] = useState<string | null>(project?.name ?? null)
  const [stableOverview, setStableOverview] = useState<GdaOverview | null>(currentOverview)

  useEffect(() => {
    setStableProjectName(project?.name ?? null)
    setStableOverview(currentOverview)
  }, [projectId])

  useEffect(() => {
    if (project?.name) {
      setStableProjectName(project.name)
    }
  }, [project?.name])

  useEffect(() => {
    if (currentOverview) {
      setStableOverview((previous) => {
        if (previous?.contextVersionId === currentOverview.contextVersionId) {
          return previous
        }
        return currentOverview
      })
    }
  }, [currentOverview])

  const overview = currentOverview ?? stableOverview
  const projectName = project?.name ?? stableProjectName ?? "Project"

  if (error && !project) {
    return (
      <BackendStatusBanner
        title="GDA live view is temporarily unavailable"
        detail={describeGraphqlError(error)}
        onRetry={() => {
          void refetch()
        }}
      />
    )
  }

  return (
    <div className="min-h-screen bg-surface">
      <div className="border-b border-border-default bg-surface/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href={`/p/${projectId}`}
            className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-default transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Dashboard
          </Link>
          <div className="h-5 w-px bg-border-default" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted">GDA Live View</div>
            <div className="text-sm font-semibold text-default truncate">
              {projectName}{overview?.objective?.name ? ` · ${overview.objective.name}` : ""}
            </div>
          </div>
          <div className="ml-auto inline-flex items-center gap-2 rounded-full border border-border-default bg-surface-raised px-3 py-1 text-[11px] text-secondary">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-accent animate-pulse-dot" />
              Polling every 3s
            </span>
            <span className="text-muted">v{overview?.contextVersionId ?? "?"}</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4">
        {!overview && loading && (
          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="rounded-2xl border border-border-default bg-surface p-4 animate-pulse">
                <div className="h-4 w-28 rounded bg-surface-sunken/60 mb-3" />
                <div className="space-y-2">
                  <div className="h-3 rounded bg-surface-sunken/40" />
                  <div className="h-3 rounded bg-surface-sunken/30" />
                  <div className="h-3 w-2/3 rounded bg-surface-sunken/30" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!overview && !loading && (
          <SectionCard title="No GDA State Yet" icon={<Radar className="h-4 w-4" />}>
            <p className="text-sm text-secondary">
              This project does not have a canonical GDA state yet. Seed the demo flow or initialize project state first.
            </p>
          </SectionCard>
        )}

        {overview && (
          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr] dotted-grid">
            <div className="space-y-4">
              <SectionCard
                title="Goals And Progress"
                eyebrow="Desired State"
                icon={<CheckCircle2 className="h-4 w-4" />}
              >
                <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-3">
                    <div>
                      <div className="text-lg font-semibold text-default">
                        {overview.objective?.name ?? "No active objective"}
                      </div>
                      {overview.objective?.description && (
                        <p className="text-sm text-secondary mt-1">{overview.objective.description}</p>
                      )}
                    </div>
                    <div className="h-2 rounded-full bg-surface-sunken overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all"
                        style={{
                          width: `${overview.progress.totalGoals > 0
                            ? (overview.progress.satisfiedGoals / overview.progress.totalGoals) * 100
                            : 0}%`,
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        [`${overview.progress.satisfiedGoals}/${overview.progress.totalGoals}`, "satisfied"],
                        [String(overview.progress.unknownGoals), "unknown"],
                        [String(overview.progress.failedGoals), "failed"],
                      ].map(([value, label]) => (
                        <div key={label} className="rounded-xl border border-border-default bg-surface-raised px-3 py-2">
                          <div className="text-[10px] uppercase tracking-[0.15em] text-muted">{label}</div>
                          <div className="text-base font-semibold text-default">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border-default bg-surface-raised p-3">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">Control Status</div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium", statusTone(overview.progress.status))}>
                        {overview.progress.status}
                      </span>
                      <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium", statusTone(overview.awareness.controlStatus))}>
                        {overview.awareness.controlStatus}
                      </span>
                    </div>
                    <div className="text-xs text-secondary">
                      Last observed: {formatTimestamp(overview.awareness.lastObservedAt)}
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {overview.progress.goalProgress.map((goal) => (
                    <div key={goal.goalId} className="rounded-2xl border border-border-default bg-surface-raised px-3 py-3">
                      <div className="flex items-start gap-3">
                        <div className={cn("mt-0.5 h-2.5 w-2.5 rounded-full", goal.status === "satisfied" ? "bg-success" : goal.status === "unknown" ? "bg-warning" : "bg-danger")} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-sm font-medium text-default">{goal.goalName}</div>
                            <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]", statusTone(goal.status))}>
                              {goal.status}
                            </span>
                          </div>
                          {goal.missingDimensions.length > 0 && (
                            <div className="text-xs text-warning mt-1">
                              Missing: {goal.missingDimensions.join(", ")}
                            </div>
                          )}
                          {goal.failedDimensions.length > 0 && (
                            <div className="text-xs text-danger mt-1">
                              Failing: {goal.failedDimensions.join(", ")}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                title="Active Commitments"
                eyebrow="Authorized Work"
                icon={<Activity className="h-4 w-4" />}
              >
                <div className="space-y-2">
                  {overview.activeCommitments.length === 0 && (
                    <div className="text-sm text-secondary">No active commitments.</div>
                  )}
                  {overview.activeCommitments.map((commitment) => (
                    <div key={commitment.commitmentId} className="rounded-2xl border border-border-default bg-surface-raised px-3 py-3">
                      <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-surface px-2 py-1 text-[10px] font-mono text-secondary border border-border-default">
                          {commitment.commitmentId}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-sm font-medium text-default">{commitment.capabilityId}</div>
                            <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]", statusTone(commitment.status))}>
                              {commitment.status}
                            </span>
                          </div>
                          <div className="text-xs text-secondary mt-1">
                            Assigned to {commitment.assignmentAgentName ?? "unassigned"}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>

            <div className="space-y-4">
              <SectionCard
                title="Recent Observations"
                eyebrow="Evidence"
                icon={<Eye className="h-4 w-4" />}
              >
                <div className="space-y-2">
                  {overview.recentObservations.length === 0 && (
                    <div className="text-sm text-secondary">No admitted observations yet.</div>
                  )}
                  {overview.recentObservations.map((observation) => (
                    <div key={observation.observationId} className="rounded-2xl border border-border-default bg-surface-raised px-3 py-3">
                      <div className="flex items-start gap-3">
                        <CircleDot className="h-4 w-4 text-accent mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-default">{observation.kind}</div>
                          <div className="text-xs text-secondary mt-1">
                            {observation.sourceKind} · {formatTimestamp(observation.observedAt)}
                          </div>
                          <div className="mt-2 text-[11px] font-mono text-muted break-all">{observation.subject}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                title="Current State"
                eyebrow="Reduced Truth"
                icon={<SquareStack className="h-4 w-4" />}
              >
                <div className="space-y-2">
                  {overview.stateEntries.length === 0 && (
                    <div className="text-sm text-secondary">No reduced state entries yet.</div>
                  )}
                  {overview.stateEntries.map((entry) => (
                    <div key={entry.dimensionId} className="rounded-2xl border border-border-default bg-surface-raised px-3 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-xs font-semibold text-default">{entry.dimensionId}</div>
                        <span className="inline-flex rounded-full border border-border-default px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-secondary">
                          {entry.origin}
                        </span>
                      </div>
                      <pre className="mt-2 overflow-x-auto text-[11px] leading-5 text-secondary font-mono whitespace-pre-wrap break-words">
                        {renderValue(entry.value)}
                      </pre>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                title="Execution Trace"
                eyebrow="Attempted Change"
                icon={<Clock3 className="h-4 w-4" />}
              >
                <div className="space-y-2">
                  {overview.recentExecutions.length === 0 && (
                    <div className="text-sm text-secondary">No executions recorded yet.</div>
                  )}
                  {overview.recentExecutions.map((execution) => (
                    <div key={execution.invocationId} className="rounded-2xl border border-border-default bg-surface-raised px-3 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-xs font-mono text-default">{execution.invocationId}</div>
                        <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]", statusTone(execution.status))}>
                          {execution.status}
                        </span>
                      </div>
                      <div className="text-xs text-secondary mt-1">
                        {execution.commitmentId ?? "No commitment"} · {formatTimestamp(execution.completedAt ?? execution.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
