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
        <span className="text-[9px] uppercase tracking-wider" style={{ color: C.textDim }}>
          {item.executionType}
        </span>
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
  const filename = data.path.split("/").pop() ?? data.path

  return (
    <div
      className="rounded border font-mono flex items-center gap-1.5 px-2 py-1"
      style={{
        backgroundColor: C.surfaceRaised,
        borderColor: C.border,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: C.border, border: "none", width: 4, height: 4 }} />
      <span className="text-[9px] font-bold" style={{ color: actionColor }}>
        {data.action === "created" ? "+" : data.action === "deleted" ? "-" : "~"}
      </span>
      <span className="text-[9px]" style={{ color: C.text }}>{filename}</span>
      {data.lines && <span className="text-[8px]" style={{ color: C.textDim }}>{data.lines}L</span>}
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

function buildGraph(items: WorkItem[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const active = items.filter(i => i.status === "active")
  const needsYou = items.filter(i => i.status === "needs-you")
  const completed = items.filter(i => i.status === "completed")
  const queued = items.filter(i => i.status === "queued")

  // Layout constants
  const taskX = 40
  const execX = 340
  const artifactX = 720
  const startY = 40
  const rowHeight = 200

  // Active work: task node → execution node → artifact nodes
  ;[...active, ...needsYou].forEach((item, i) => {
    const y = startY + i * rowHeight

    // Task node
    nodes.push({
      id: `task-${item.id}`,
      type: "taskNode",
      position: { x: taskX, y },
      data: { item },
    })

    // Execution node
    nodes.push({
      id: `exec-${item.id}`,
      type: "executionNode",
      position: { x: execX, y: y - 20 },
      data: { item },
    })

    // Edge: task → execution
    edges.push({
      id: `e-task-exec-${item.id}`,
      source: `task-${item.id}`,
      target: `exec-${item.id}`,
      type: "typedEdge",
      data: { edgeType: item.status === "needs-you" ? "blocked_by" : "attached_to" },
    })

    // Artifact nodes
    item.artifacts.slice(0, 3).forEach((art, ai) => {
      const artId = `art-${item.id}-${ai}`
      nodes.push({
        id: artId,
        type: "artifactNode",
        position: { x: artifactX, y: y + ai * 30 },
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

  // Completed work: small task node only (collapsed)
  completed.forEach((item, i) => {
    const y = startY + ([...active, ...needsYou].length) * rowHeight + i * 80
    nodes.push({
      id: `task-${item.id}`,
      type: "taskNode",
      position: { x: taskX + 60, y },
      data: { item },
    })
  })

  // Inbox node for queued work
  if (queued.length > 0) {
    nodes.push({
      id: "inbox",
      type: "inboxNode",
      position: { x: taskX, y: startY + ([...active, ...needsYou].length + completed.length) * rowHeight - (completed.length > 0 ? 120 : 0) },
      data: { items: queued },
    })
  }

  // Delegation edges between related tasks
  // W-42 has subtasks that could delegate — show one example edge
  const w42Task = items.find(i => i.id === "W-42")
  if (w42Task) {
    const w42Completed = items.find(i => i.id === "W-40") // test-runner is downstream
    if (w42Completed) {
      edges.push({
        id: "e-delegation-42-40",
        source: `task-W-42`,
        target: `task-W-40`,
        type: "typedEdge",
        data: { edgeType: "delegates_to" },
      })
    }
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
      {/* Graph canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.3}
          maxZoom={1.5}
          defaultEdgeOptions={{ animated: false }}
          proOptions={{ hideAttribution: true }}
          style={{ backgroundColor: C.surface }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e2230" />
        </ReactFlow>

        {/* Edge legend */}
        <div
          className="absolute top-3 right-3 rounded-md border px-3 py-2 font-mono space-y-1"
          style={{ backgroundColor: C.surfaceRaised, borderColor: C.border, zIndex: 10 }}
        >
          <span className="text-[8px] uppercase tracking-widest font-bold block mb-1" style={{ color: C.textDim }}>edges</span>
          {[
            { label: "delegates_to", color: C.blue, dash: "" },
            { label: "attached_to", color: C.textDim, dash: "6 4" },
            { label: "produced", color: C.green, dash: "3 3" },
            { label: "blocked_by", color: C.red, dash: "8 4" },
          ].map(e => (
            <div key={e.label} className="flex items-center gap-2">
              <svg width="24" height="6">
                <line x1="0" y1="3" x2="24" y2="3" stroke={e.color} strokeWidth="1.5" strokeDasharray={e.dash || undefined} />
              </svg>
              <span className="text-[8px]" style={{ color: C.text }}>{e.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Intervention tray + command bar */}
      {needsYou.length > 0 && (
        <div
          className="flex items-center gap-3 px-4 border-t font-mono"
          style={{ height: 38, borderColor: C.amber, backgroundColor: `color-mix(in srgb, ${C.amber} 5%, ${C.surface})` }}
        >
          {(() => {
            const item = needsYou[0]
            const inv = item.intervention!
            return (
              <>
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: agentColor(item.agent) }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.amber }}>{item.id}</span>
                <span className="text-[10px] font-semibold" style={{ color: agentColor(item.agent) }}>@{item.agent}</span>
                <span className="text-[10px]" style={{ color: C.text }}>{inv.type}:</span>
                <span className="text-[10px] flex-1 truncate" style={{ color: C.textBright }}>{inv.summary}</span>
                {inv.options?.map(opt => (
                  <button key={opt} type="button" className="rounded border px-2.5 py-0.5 text-[9px] font-semibold"
                    style={{ borderColor: opt === "Allow" ? C.green : C.border, color: opt === "Allow" ? C.green : C.text, backgroundColor: "transparent" }}>
                    {opt}
                  </button>
                ))}
              </>
            )
          })()}
        </div>
      )}

      {/* Command bar */}
      <div
        className="flex items-center gap-4 px-4 border-t font-mono"
        style={{ height: 36, borderColor: C.border, backgroundColor: "#0f1218" }}
      >
        <span className="text-[12px] font-semibold tracking-wide" style={{ color: C.textDim }}>{PROJECT_SUMMARY.name}</span>
        <div className="h-3 w-px" style={{ backgroundColor: C.border }} />
        <span className="text-[10px]" style={{ color: C.text }}>{PROJECT_SUMMARY.activeAgents} active</span>
        <span className="text-[10px]" style={{ color: C.text }}>{PROJECT_SUMMARY.completedWork}/{PROJECT_SUMMARY.totalWork} done</span>
        <span className="text-[10px]" style={{ color: C.textBright }}>{formatCost(PROJECT_SUMMARY.totalCost)}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2 rounded border px-2.5 py-1 max-w-[400px] flex-1" style={{ borderColor: C.border, backgroundColor: C.surface }}>
          <span className="text-[12px]" style={{ color: C.amber }}>&rsaquo;</span>
          <span className="text-[10px]" style={{ color: C.textDim }}>describe what you want done...</span>
        </div>
        <div className="flex-1" />
        <span className="text-[8px] uppercase tracking-widest" style={{ color: C.textDim }}>graph workspace</span>
      </div>
    </div>
  )
}
