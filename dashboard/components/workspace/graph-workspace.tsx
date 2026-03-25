"use client"

import { useCallback, useMemo } from "react"
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  Handle,
  Position,
  BaseEdge,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import {
  MOCK_WORK_ITEMS,
  PROJECT_SUMMARY,
  type WorkItem,
  type WorkStatus,
} from "@/components/console/mock-data"

/* ================================================================== */
/*  PALETTE                                                            */
/* ================================================================== */

const C = {
  surface: "#141720",
  surfaceRaised: "#1a1e28",
  surfaceNode: "#1c2030",
  border: "#2a2e3a",
  borderActive: "#3a4050",
  text: "#8b95a5",
  textBright: "#c5cdd8",
  textDim: "#3d4555",
  green: "#8ec07c",
  amber: "#d5a868",
  red: "#d86c6c",
  blue: "#7aa2d4",
  purple: "#b39fce",
  muted: "#6b7280",
}

function statusColor(s: WorkStatus): string {
  switch (s) {
    case "active": return C.green
    case "needs-you": return C.amber
    case "completed": return C.muted
    case "failed": return C.red
    case "blocked": return C.amber
    case "queued": return C.textDim
  }
}

function agentHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return ((h % 360) + 360) % 360
}
function agentColor(name: string) { return `hsl(${agentHue(name)}, 50%, 62%)` }

function formatCost(c: number) { return c > 0 ? `$${c.toFixed(2)}` : "" }

/* ================================================================== */
/*  CUSTOM EDGE: TYPED RELATIONSHIPS                                   */
/* ================================================================== */

type EdgeData = { edgeType?: "delegates_to" | "attached_to" | "produced" | "blocked_by" }

function TypedEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<EdgeData>>) {
  const edgeType = data?.edgeType ?? "attached_to"

  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
    borderRadius: 8,
  })

  const style: React.CSSProperties = (() => {
    switch (edgeType) {
      case "delegates_to":
        return { stroke: C.blue, strokeWidth: 1.5 }
      case "attached_to":
        return { stroke: C.textDim, strokeWidth: 1, strokeDasharray: "6 4" }
      case "produced":
        return { stroke: C.green, strokeWidth: 1, strokeDasharray: "3 3" }
      case "blocked_by":
        return { stroke: C.red, strokeWidth: 1.5, strokeDasharray: "8 4" }
    }
  })()

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      {(edgeType === "delegates_to" || edgeType === "produced") && (
        <circle r="3" fill={edgeType === "delegates_to" ? C.blue : C.green}>
          <animateMotion dur="3s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}
    </>
  )
}

/* ================================================================== */
/*  CUSTOM NODE: INPUT (left lane — raw signals entering the system)   */
/* ================================================================== */

type InputNodeData = { source: string; title: string; origin: string; timestamp: string }

function InputNode({ data }: { data: InputNodeData }) {
  const iconMap: Record<string, string> = { "github-issue": "\u2693", "human-request": "\u270e", observation: "\u25c9", alert: "\u26a0" }
  const icon = iconMap[data.source] ?? "\u2192"
  return (
    <div className="rounded-md border font-mono" style={{ width: 160, backgroundColor: C.surfaceRaised, borderColor: C.border }}>
      <Handle type="source" position={Position.Right} style={{ background: C.border, border: "none", width: 5, height: 5 }} />
      <div className="px-2.5 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px]">{icon}</span>
          <span className="text-[8px] uppercase tracking-widest font-bold" style={{ color: C.textDim }}>{data.source}</span>
        </div>
        <p className="text-[10px] font-medium leading-snug mb-1" style={{ color: C.textBright }}>{data.title}</p>
        <div className="flex items-center gap-2">
          <span className="text-[8px] truncate" style={{ color: C.blue }}>{data.origin}</span>
          <span className="text-[8px]" style={{ color: C.textDim }}>{data.timestamp}</span>
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/*  CUSTOM NODE: EXECUTION                                             */
/* ================================================================== */

type ExecNodeData = { item: WorkItem }

function ExecutionNode({ data }: { data: ExecNodeData }) {
  const item = data.item
  const sc = statusColor(item.status)
  const isActive = item.status === "active"
  const done = item.tasks.filter(t => t.status === "done").length
  const total = item.tasks.length

  // Show last few lines of terminal output
  const outputLines = (item.terminalOutput ?? [])
    .map(l => l.replace(/\x1b\[[0-9;]*m/g, ""))
    .filter(l => l.trim())
    .slice(-5)

  return (
    <div
      className="rounded-lg border font-mono"
      style={{
        width: 320,
        backgroundColor: C.surfaceNode,
        borderColor: isActive ? sc : C.border,
        boxShadow: isActive ? `0 0 20px ${sc}15` : "0 4px 20px rgba(0,0,0,0.3)",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: C.border, border: "none", width: 6, height: 6 }} />
      <Handle type="source" position={Position.Right} style={{ background: C.border, border: "none", width: 6, height: 6 }} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ background: C.border, border: "none", width: 6, height: 6 }} />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: C.border }}>
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{
            backgroundColor: sc,
            boxShadow: isActive ? `0 0 8px ${sc}` : "none",
          }}
        />
        <span className="text-[11px] font-semibold" style={{ color: agentColor(item.agent) }}>
          @{item.agent}
        </span>
        {/* Surface toggle */}
        <div className="flex items-center gap-px rounded overflow-hidden border" style={{ borderColor: C.border }}>
          {(["terminal", "browser", "desktop"] as const).map(mode => {
            const label = mode === "terminal" ? "TRM" : mode === "browser" ? "BRW" : "DSK"
            const active = item.executionType === mode
            return (
              <span
                key={mode}
                className="text-[7px] font-bold uppercase tracking-wider px-1.5 py-0.5"
                style={{
                  backgroundColor: active ? `${agentColor(item.agent)}18` : "transparent",
                  color: active ? agentColor(item.agent) : C.textDim,
                }}
              >
                {label}
              </span>
            )
          })}
        </div>
        <div className="flex-1" />
        <span className="text-[9px]" style={{ color: C.textDim }}>{done}/{total}</span>
        <span className="text-[9px]" style={{ color: C.text }}>{formatCost(item.cost)}</span>
      </div>

      {/* Terminal output preview */}
      <div className="px-3 py-2" style={{ minHeight: 60 }}>
        {outputLines.length > 0 ? (
          <pre className="text-[10px] leading-[1.5] whitespace-pre-wrap" style={{ color: C.text }}>
            {outputLines.map((line, i) => (
              <span key={i} className="block truncate" style={{
                color: line.includes("PASSED") ? C.green
                  : line.includes("Permission") || line.includes("Waiting") ? C.amber
                  : line.startsWith("$") ? C.textDim
                  : C.text,
              }}>
                {line}
              </span>
            ))}
          </pre>
        ) : (
          <span className="text-[10px]" style={{ color: C.textDim }}>
            {item.status === "queued" ? "awaiting execution" : "no output"}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="px-3 pb-2">
          <div className="h-[2px] w-full rounded-full overflow-hidden" style={{ backgroundColor: C.border }}>
            <div className="h-full rounded-full" style={{ width: `${(done / total) * 100}%`, backgroundColor: sc }} />
          </div>
        </div>
      )}
    </div>
  )
}

/* ================================================================== */
/*  CUSTOM NODE: TASK                                                  */
/* ================================================================== */

type TaskNodeData = { item: WorkItem }

function TaskNode({ data }: { data: TaskNodeData }) {
  const item = data.item
  const sc = statusColor(item.status)
  const done = item.tasks.filter(t => t.status === "done").length
  const total = item.tasks.length
  const isNeedsYou = item.status === "needs-you"

  return (
    <div
      className="rounded-md border font-mono"
      style={{
        width: 180,
        backgroundColor: C.surfaceRaised,
        borderColor: isNeedsYou ? C.amber : C.border,
        boxShadow: isNeedsYou ? `0 0 12px ${C.amber}20` : "none",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: C.border, border: "none", width: 5, height: 5 }} />
      <Handle type="source" position={Position.Right} style={{ background: C.border, border: "none", width: 5, height: 5 }} />

      <div className="px-2.5 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>{item.id}</span>
          <div className="flex-1" />
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: sc }} />
        </div>
        <p className="text-[11px] font-medium leading-snug mb-1.5" style={{ color: C.textBright }}>
          {item.title}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold" style={{ color: agentColor(item.agent) }}>@{item.agent}</span>
          <span className="text-[9px]" style={{ color: C.textDim }}>{done}/{total}</span>
          {item.cost > 0 && <span className="text-[9px]" style={{ color: C.textDim }}>{formatCost(item.cost)}</span>}
        </div>
        {isNeedsYou && (
          <div className="mt-1.5 rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ backgroundColor: `${C.amber}15`, color: C.amber }}>
            needs your attention
          </div>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  CUSTOM NODE: ARTIFACT                                              */
/* ================================================================== */

type ArtifactNodeData = { path: string; action: string; lines?: number }

function ArtifactNode({ data }: { data: ArtifactNodeData }) {
  const actionColor = data.action === "created" ? C.green : data.action === "deleted" ? C.red : C.amber
  const actionLabel = data.action === "created" ? "new" : data.action === "deleted" ? "del" : "mod"
  const filename = data.path.split("/").pop() ?? data.path
  const ext = filename.split(".").pop()?.toUpperCase() ?? ""

  return (
    <div
      className="rounded-md border font-mono"
      style={{ width: 140, backgroundColor: C.surfaceRaised, borderColor: C.border }}
    >
      <Handle type="target" position={Position.Left} style={{ background: C.border, border: "none", width: 5, height: 5 }} />
      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[9px] font-bold" style={{ color: actionColor }}>
            {data.action === "created" ? "+" : data.action === "deleted" ? "\u2212" : "~"}
          </span>
          <span className="text-[9px] font-semibold truncate flex-1" style={{ color: C.textBright }}>{filename}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {ext && <span className="text-[7px] font-bold uppercase rounded px-1 py-px" style={{ backgroundColor: C.border, color: C.textDim }}>{ext}</span>}
          {data.lines && <span className="text-[8px]" style={{ color: C.textDim }}>{data.lines}L</span>}
          <span className="text-[7px] font-bold uppercase" style={{ color: actionColor }}>{actionLabel}</span>
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/*  CUSTOM NODE: INBOX                                                 */
/* ================================================================== */

type InboxNodeData = { items: WorkItem[] }

function InboxNode({ data }: { data: InboxNodeData }) {
  return (
    <div className="rounded-md border font-mono" style={{ width: 160, backgroundColor: C.surfaceRaised, borderColor: C.border }}>
      <Handle type="source" position={Position.Right} style={{ background: C.border, border: "none", width: 5, height: 5 }} />
      <div className="px-2.5 py-1.5 border-b" style={{ borderColor: C.border }}>
        <span className="text-[9px] uppercase tracking-widest font-bold" style={{ color: C.textDim }}>inbox</span>
        <span className="text-[9px] ml-2" style={{ color: C.textDim }}>{data.items.length}</span>
      </div>
      <div className="px-2.5 py-1.5 space-y-1">
        {data.items.map(item => (
          <div key={item.id} className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full" style={{ backgroundColor: C.textDim }} />
            <span className="text-[9px] truncate" style={{ color: C.text }}>{item.title}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  GRAPH DATA                                                         */
/* ================================================================== */

// Mock inputs — raw signals entering the system
const MOCK_INPUTS = [
  { id: "in-1", source: "github-issue", title: "Auth middleware is duplicated across routes", origin: "github.com/agentobox#42", timestamp: "12m ago" },
  { id: "in-2", source: "github-issue", title: "Staging env needs reprovisioning", origin: "github.com/agentobox#41", timestamp: "34m ago" },
  { id: "in-3", source: "human-request", title: "Fix VNC reconnect after redeploy", origin: "vahid", timestamp: "1h ago" },
  { id: "in-4", source: "observation", title: "Feed API has zero test coverage", origin: "test-runner scan", timestamp: "2h ago" },
]

function buildGraph(items: WorkItem[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const active = items.filter(i => i.status === "active")
  const needsYou = items.filter(i => i.status === "needs-you")
  const completed = items.filter(i => i.status === "completed")
  const queued = items.filter(i => i.status === "queued")
  const liveItems = [...active, ...needsYou]

  // Lane positions (implicit left-to-right flow)
  const inputX = 0
  const taskX = 200
  const execX = 440
  const artifactX = 820
  const startY = 20
  const rowHeight = 220

  // Input nodes (left lane)
  MOCK_INPUTS.forEach((inp, i) => {
    nodes.push({
      id: `input-${inp.id}`,
      type: "inputNode",
      position: { x: inputX, y: startY + i * 80 },
      data: inp,
    })
  })

  // Active work: input → task → execution → artifacts
  liveItems.forEach((item, i) => {
    const y = startY + i * rowHeight

    // Task node (close to execution — "docked" feel)
    nodes.push({
      id: `task-${item.id}`,
      type: "taskNode",
      position: { x: taskX, y: y + 10 },
      data: { item },
    })

    // Execution node
    nodes.push({
      id: `exec-${item.id}`,
      type: "executionNode",
      position: { x: execX, y },
      data: { item },
    })

    // Edge: task → execution (short, docking feel)
    edges.push({
      id: `e-task-exec-${item.id}`,
      source: `task-${item.id}`,
      target: `exec-${item.id}`,
      type: "typedEdge",
      data: { edgeType: item.status === "needs-you" ? "blocked_by" : "attached_to" },
    })

    // Edge: input → task (interpretation)
    const matchingInput = MOCK_INPUTS[i]
    if (matchingInput) {
      edges.push({
        id: `e-input-task-${item.id}`,
        source: `input-${matchingInput.id}`,
        target: `task-${item.id}`,
        type: "typedEdge",
        data: { edgeType: "delegates_to" },
      })
    }

    // Artifact nodes (right lane, stacked vertically per execution)
    item.artifacts.slice(0, 3).forEach((art, ai) => {
      const artId = `art-${item.id}-${ai}`
      nodes.push({
        id: artId,
        type: "artifactNode",
        position: { x: artifactX, y: y + ai * 40 },
        data: { path: art.path, action: art.action, lines: art.lines },
      })
      edges.push({
        id: `e-exec-art-${item.id}-${ai}`,
        source: `exec-${item.id}`,
        sourceHandle: "bottom",
        target: artId,
        type: "typedEdge",
        data: { edgeType: "produced" },
      })
    })
  })

  // Completed: collapsed, lower right
  completed.forEach((item, i) => {
    const y = startY + liveItems.length * rowHeight + i * 70
    nodes.push({
      id: `task-${item.id}`,
      type: "taskNode",
      position: { x: taskX + 200, y },
      data: { item },
    })
  })

  // Queued work as inbox
  if (queued.length > 0) {
    nodes.push({
      id: "inbox",
      type: "inboxNode",
      position: { x: inputX, y: startY + MOCK_INPUTS.length * 80 + 10 },
      data: { items: queued },
    })
  }

  // Delegation edge: W-42 → W-40 (tests were delegated)
  if (items.find(i => i.id === "W-42") && items.find(i => i.id === "W-40")) {
    edges.push({
      id: "e-delegation-42-40",
      source: `task-W-42`,
      target: `task-W-40`,
      type: "typedEdge",
      data: { edgeType: "delegates_to" },
    })
  }

  return { nodes, edges }
}

/* ================================================================== */
/*  NODE + EDGE TYPE REGISTRIES                                        */
/* ================================================================== */

const nodeTypes: NodeTypes = {
  executionNode: ExecutionNode as any,
  taskNode: TaskNode as any,
  artifactNode: ArtifactNode as any,
  inboxNode: InboxNode as any,
  inputNode: InputNode as any,
}

const edgeTypes: EdgeTypes = {
  typedEdge: TypedEdge as any,
}

/* ================================================================== */
/*  MAIN COMPONENT                                                     */
/* ================================================================== */

export function GraphWorkspace() {
  const { nodes, edges } = useMemo(() => buildGraph(MOCK_WORK_ITEMS), [])

  // Find needs-you items for the intervention tray
  const needsYou = MOCK_WORK_ITEMS.filter(i => i.intervention)

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: C.surface }}>
      {/* ── TOP BAR: global command + status ──────────────── */}
      <div className="font-mono border-b" style={{ borderColor: C.border, backgroundColor: "#0f1218" }}>
        <div className="flex items-center gap-3 px-4" style={{ height: 40 }}>
          <span className="text-[12px] font-bold tracking-wide" style={{ color: C.textDim }}>{PROJECT_SUMMARY.name}</span>
          <div className="h-3 w-px" style={{ backgroundColor: C.border }} />
          <span className="text-[10px] tabular-nums" style={{ color: C.text }}>{PROJECT_SUMMARY.activeAgents} active</span>
          <span className="text-[10px] tabular-nums" style={{ color: C.text }}>{PROJECT_SUMMARY.completedWork}/{PROJECT_SUMMARY.totalWork} done</span>
          <span className="text-[10px] font-semibold tabular-nums" style={{ color: C.textBright }}>{formatCost(PROJECT_SUMMARY.totalCost)}</span>
          {needsYou.length > 0 && (
            <>
              <div className="h-3 w-px" style={{ backgroundColor: C.border }} />
              <span className="text-[9px] font-bold uppercase" style={{ color: C.amber }}>
                {needsYou.length} needs you
              </span>
            </>
          )}
          <div className="flex-1" />
          {/* Command palette input */}
          <div
            className="flex items-center gap-2 rounded-lg border px-3 py-1.5 max-w-[480px] flex-1"
            style={{ borderColor: C.border, backgroundColor: C.surface }}
          >
            <span className="text-[12px]" style={{ color: C.amber }}>/</span>
            <span className="text-[11px]" style={{ color: C.textDim }}>jump, create, delegate, approve...</span>
            <span className="inline-block h-[13px] w-[6px] animate-pulse" style={{ backgroundColor: C.amber, opacity: 0.5 }} />
          </div>
          <div className="flex-1" />
          <span className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: C.border, color: C.text }}>V</span>
        </div>

        {/* Intervention row (conditional) */}
        {needsYou.length > 0 && (
          <div
            className="flex items-center gap-3 px-4 border-t"
            style={{ height: 34, borderColor: `${C.amber}30`, backgroundColor: `color-mix(in srgb, ${C.amber} 3%, #0f1218)` }}
          >
            {needsYou.map(item => {
              const inv = item.intervention!
              return (
                <div key={item.id} className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: agentColor(item.agent) }} />
                  <span className="text-[9px] font-semibold" style={{ color: agentColor(item.agent) }}>@{item.agent}</span>
                  <span className="text-[9px]" style={{ color: C.text }}>{inv.type}:</span>
                  <span className="text-[9px] truncate flex-1" style={{ color: C.textBright }}>{inv.summary}</span>
                  {inv.options?.map(opt => (
                    <button key={opt} type="button" className="rounded border px-2 py-0.5 text-[8px] font-semibold shrink-0"
                      style={{
                        borderColor: opt === "Allow" || opt === "Approve" ? C.green : C.border,
                        color: opt === "Allow" || opt === "Approve" ? C.green : C.text,
                        backgroundColor: "transparent",
                      }}>
                      {opt}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── GRAPH CANVAS ─────────────────────────────────── */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          style={{ backgroundColor: C.surface }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e2230" />
        </ReactFlow>
      </div>
    </div>
  )
}
