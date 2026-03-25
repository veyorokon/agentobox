"use client"

import { useMemo } from "react"
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
  nodeBg: "#181c26",
  border: "#2a2e3a",
  borderActive: "#3a4050",
  text: "#8b95a5",
  textBright: "#c5cdd8",
  textDim: "#3d4555",
  green: "#8ec07c",
  amber: "#d5a868",
  red: "#d86c6c",
  blue: "#7aa2d4",
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
function agentBg(name: string) { return `hsl(${agentHue(name)}, 25%, 14%)` }
function formatCost(c: number) { return c > 0 ? `$${c.toFixed(2)}` : "" }

/* ================================================================== */
/*  EDGE: SIMPLIFIED — only delegation and blocked                     */
/* ================================================================== */

type EdgeData = { edgeType?: "delegates_to" | "blocked_by" }

function WorkEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<EdgeData>>) {
  const edgeType = data?.edgeType ?? "delegates_to"
  const [edgePath] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12 })

  const isBlocked = edgeType === "blocked_by"
  const color = isBlocked ? C.red : C.blue

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{
        stroke: color,
        strokeWidth: isBlocked ? 1.5 : 1.2,
        strokeDasharray: isBlocked ? "8 4" : undefined,
        opacity: 0.6,
      }} />
      {!isBlocked && (
        <circle r="2.5" fill={color} opacity="0.7">
          <animateMotion dur="4s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}
    </>
  )
}

/* ================================================================== */
/*  EXECUTION NODE — the primary work surface                          */
/*                                                                     */
/*  Contains: task ribbon (docked) + terminal preview + artifact shelf  */
/* ================================================================== */

type ExecNodeData = { item: WorkItem }

function ExecutionNode({ data }: { data: ExecNodeData }) {
  const item = data.item
  const sc = statusColor(item.status)
  const ac = agentColor(item.agent)
  const isActive = item.status === "active"
  const isNeedsYou = item.status === "needs-you"
  const done = item.tasks.filter(t => t.status === "done").length
  const total = item.tasks.length

  const outputLines = (item.terminalOutput ?? [])
    .map(l => l.replace(/\x1b\[[0-9;]*m/g, ""))
    .filter(l => l.trim())
    .slice(-7)

  return (
    <div
      className="rounded-xl font-mono overflow-hidden"
      style={{
        width: 380,
        backgroundColor: C.nodeBg,
        border: `1.5px solid ${isActive ? sc : isNeedsYou ? C.amber : C.border}`,
        boxShadow: isActive
          ? `0 0 30px ${sc}12, 0 8px 32px rgba(0,0,0,0.4)`
          : isNeedsYou
            ? `0 0 24px ${C.amber}15, 0 8px 32px rgba(0,0,0,0.4)`
            : "0 8px 32px rgba(0,0,0,0.4)",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: C.border, border: "none", width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ background: C.border, border: "none", width: 8, height: 8 }} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ background: C.border, border: "none", width: 8, height: 8 }} />

      {/* ── TASK RIBBON (docked onto the node) ──────────── */}
      <div
        className="flex items-center gap-2 px-3 py-1.5"
        style={{ backgroundColor: agentBg(item.agent), borderBottom: `1px solid ${C.border}` }}
      >
        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>{item.id}</span>
        <span className="text-[10px] font-medium truncate flex-1" style={{ color: C.textBright }}>{item.title}</span>
        <span className="text-[9px] tabular-nums" style={{ color: C.textDim }}>{done}/{total}</span>
        {item.cost > 0 && <span className="text-[9px] tabular-nums font-semibold" style={{ color: C.text }}>{formatCost(item.cost)}</span>}
        {isNeedsYou && (
          <span className="text-[8px] font-bold uppercase px-1.5 py-px rounded" style={{ backgroundColor: `${C.amber}20`, color: C.amber }}>
            needs you
          </span>
        )}
      </div>

      {/* ── AGENT + EXECUTION TYPE HEADER ───────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: `1px solid ${C.border}` }}>
        <span
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: sc, boxShadow: isActive ? `0 0 8px ${sc}` : "none" }}
        />
        <span className="text-[11px] font-semibold" style={{ color: ac }}>@{item.agent}</span>
        <span
          className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded"
          style={{ backgroundColor: `${ac}12`, color: ac }}
        >
          {item.executionType}
        </span>
        <div className="flex-1" />
        <span className="text-[9px]" style={{ color: C.textDim }}>{item.turns} turns</span>
        <span className="text-[9px]" style={{ color: C.textDim }}>{item.elapsed}</span>
      </div>

      {/* ── TERMINAL OUTPUT ─────────────────────────────── */}
      <div className="px-3 py-2.5 relative" style={{ minHeight: 80, backgroundColor: "#0e1118" }}>
        {isActive && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ opacity: 0.03 }}>
            <div className="absolute inset-x-0 h-px" style={{ backgroundColor: C.green, animation: "scan-line 5s linear infinite" }} />
          </div>
        )}
        {outputLines.length > 0 ? (
          <pre className="text-[10px] leading-[1.6] whitespace-pre-wrap" style={{ color: C.text }}>
            {outputLines.map((line, i) => (
              <span key={i} className="block" style={{
                color: line.includes("PASSED") || line.includes("passed") ? C.green
                  : line.includes("Permission") || line.includes("Waiting") || line.includes("\u26a0") ? C.amber
                  : line.startsWith("$") || line.startsWith("+ ") ? C.textDim
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

      {/* ── PROGRESS BAR ────────────────────────────────── */}
      {total > 0 && (
        <div className="h-[2px]" style={{ backgroundColor: C.border }}>
          <div className="h-full transition-all" style={{ width: `${(done / total) * 100}%`, backgroundColor: sc }} />
        </div>
      )}

      {/* ── ARTIFACT SHELF (docked below terminal) ──────── */}
      {item.artifacts.length > 0 && (
        <div className="px-3 py-2 space-y-1" style={{ backgroundColor: C.nodeBg }}>
          <span className="text-[8px] uppercase tracking-widest font-bold" style={{ color: C.textDim }}>outputs</span>
          <div className="flex flex-wrap gap-1">
            {item.artifacts.slice(0, 4).map((art, i) => {
              const actionColor = art.action === "created" ? C.green : art.action === "deleted" ? C.red : C.amber
              const filename = art.path.split("/").pop() ?? art.path
              return (
                <div
                  key={i}
                  className="flex items-center gap-1 rounded border px-1.5 py-0.5"
                  style={{ backgroundColor: "#12151c", borderColor: C.border }}
                >
                  <span className="text-[8px] font-bold" style={{ color: actionColor }}>
                    {art.action === "created" ? "+" : art.action === "deleted" ? "\u2212" : "~"}
                  </span>
                  <span className="text-[8px] truncate" style={{ color: C.text, maxWidth: 80 }}>{filename}</span>
                  {art.lines && <span className="text-[7px]" style={{ color: C.textDim }}>{art.lines}L</span>}
                </div>
              )
            })}
            {item.artifacts.length > 4 && (
              <span className="text-[8px] self-center" style={{ color: C.textDim }}>+{item.artifacts.length - 4}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ================================================================== */
/*  COMPLETED NODE — collapsed work                                    */
/* ================================================================== */

type CompletedNodeData = { item: WorkItem }

function CompletedNode({ data }: { data: CompletedNodeData }) {
  const item = data.item
  return (
    <div
      className="rounded-lg border font-mono px-3 py-2 opacity-50"
      style={{ width: 200, backgroundColor: C.surfaceRaised, borderColor: C.border }}
    >
      <Handle type="target" position={Position.Top} style={{ background: C.border, border: "none", width: 6, height: 6 }} />
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>{item.id}</span>
        <span className="text-[8px]" style={{ color: C.green }}>{"\u2713"}</span>
        <div className="flex-1" />
        <span className="text-[9px]" style={{ color: C.textDim }}>{formatCost(item.cost)}</span>
      </div>
      <p className="text-[10px] leading-snug" style={{ color: C.muted }}>{item.title}</p>
      <span className="text-[8px]" style={{ color: C.textDim }}>@{item.agent} · {item.tasks.length}/{item.tasks.length} done</span>
    </div>
  )
}

/* ================================================================== */
/*  INBOX NODE                                                         */
/* ================================================================== */

type InboxNodeData = { items: WorkItem[] }

function InboxNode({ data }: { data: InboxNodeData }) {
  return (
    <div className="rounded-lg border font-mono" style={{ width: 180, backgroundColor: C.surfaceRaised, borderColor: C.border }}>
      <Handle type="source" position={Position.Top} style={{ background: C.border, border: "none", width: 6, height: 6 }} />
      <div className="px-3 py-1.5 border-b" style={{ borderColor: C.border }}>
        <span className="text-[9px] uppercase tracking-widest font-bold" style={{ color: C.textDim }}>queue</span>
        <span className="text-[9px] ml-2 font-semibold" style={{ color: C.text }}>{data.items.length}</span>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {data.items.map(item => (
          <div key={item.id} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: C.textDim }} />
            <span className="text-[9px] truncate" style={{ color: C.text }}>{item.title}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  GRAPH BUILDER                                                      */
/* ================================================================== */

function buildGraph(items: WorkItem[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const active = items.filter(i => i.status === "active")
  const needsYou = items.filter(i => i.status === "needs-you")
  const completed = items.filter(i => i.status === "completed")
  const queued = items.filter(i => i.status === "queued")

  const liveItems = [...active, ...needsYou]

  // Layout: execution nodes are the anchors, spaced vertically
  const startX = 80
  const startY = 40
  const rowHeight = 260

  liveItems.forEach((item, i) => {
    nodes.push({
      id: `exec-${item.id}`,
      type: "executionNode",
      position: { x: startX, y: startY + i * rowHeight },
      data: { item },
    })
  })

  // Completed: collapsed, positioned to the right and below
  completed.forEach((item, i) => {
    const y = startY + liveItems.length * rowHeight + i * 70
    nodes.push({
      id: `done-${item.id}`,
      type: "completedNode",
      position: { x: startX + 420, y },
      data: { item },
    })
  })

  // Delegation edge: W-42 delegated tests to W-40 (completed)
  if (items.find(i => i.id === "W-42") && items.find(i => i.id === "W-40")) {
    edges.push({
      id: "e-delegate-42-40",
      source: "exec-W-42",
      target: "done-W-40",
      type: "workEdge",
      data: { edgeType: "delegates_to" },
    })
  }

  // Queued work
  if (queued.length > 0) {
    nodes.push({
      id: "queue",
      type: "inboxNode",
      position: { x: startX + 420, y: startY },
      data: { items: queued },
    })
  }

  return { nodes, edges }
}

/* ================================================================== */
/*  REGISTRIES                                                         */
/* ================================================================== */

const nodeTypes: NodeTypes = {
  executionNode: ExecutionNode as any,
  completedNode: CompletedNode as any,
  inboxNode: InboxNode as any,
}

const edgeTypes: EdgeTypes = {
  workEdge: WorkEdge as any,
}

/* ================================================================== */
/*  CSS KEYFRAMES                                                      */
/* ================================================================== */

const KEYFRAMES = `
@keyframes scan-line {
  0% { top: 0; }
  100% { top: 100%; }
}
`

/* ================================================================== */
/*  MAIN                                                               */
/* ================================================================== */

export function GraphWorkspace() {
  const { nodes, edges } = useMemo(() => buildGraph(MOCK_WORK_ITEMS), [])
  const needsYou = MOCK_WORK_ITEMS.filter(i => i.intervention)
  const activeItems = MOCK_WORK_ITEMS.filter(i => i.status === "active" || i.status === "needs-you")

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />
      <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: C.surface }}>
        {/* Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.3}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
            style={{ backgroundColor: C.surface }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e2230" />
          </ReactFlow>
        </div>

        {/* ── BOTTOM STRIP: intervention + agents + command ── */}
        <div className="font-mono border-t" style={{ borderColor: C.border, backgroundColor: "#0f1218" }}>
          {/* Intervention row */}
          {needsYou.length > 0 && (
            <div
              className="flex items-center gap-3 px-4 border-b"
              style={{ height: 40, borderColor: `${C.amber}40`, backgroundColor: `color-mix(in srgb, ${C.amber} 4%, #0f1218)` }}
            >
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: C.amber }}>action needed</span>
              <div className="h-3 w-px" style={{ backgroundColor: `${C.amber}30` }} />
              {needsYou.map(item => {
                const inv = item.intervention!
                return (
                  <div key={item.id} className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: agentColor(item.agent) }} />
                    <span className="text-[10px] font-semibold" style={{ color: agentColor(item.agent) }}>@{item.agent}</span>
                    <span className="text-[10px]" style={{ color: C.text }}>{inv.type}:</span>
                    <span className="text-[10px] truncate flex-1" style={{ color: C.textBright }}>{inv.summary}</span>
                    {inv.options?.map(opt => (
                      <button key={opt} type="button" className="rounded border px-2.5 py-0.5 text-[9px] font-semibold shrink-0 transition-colors"
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

          {/* Agent status + command */}
          <div className="flex items-center gap-3 px-4" style={{ height: 44 }}>
            {/* Project */}
            <span className="text-[12px] font-bold tracking-wide" style={{ color: C.textDim }}>{PROJECT_SUMMARY.name}</span>

            {/* Active agent pills */}
            <div className="flex items-center gap-1.5">
              {activeItems.map(item => (
                <div
                  key={item.id}
                  className="flex items-center gap-1.5 rounded-full border px-2 py-0.5"
                  style={{
                    borderColor: item.status === "needs-you" ? C.amber : `${agentColor(item.agent)}30`,
                    backgroundColor: item.status === "needs-you" ? `${C.amber}08` : `${agentColor(item.agent)}06`,
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: statusColor(item.status) }}
                  />
                  <span className="text-[9px] font-semibold" style={{ color: agentColor(item.agent) }}>@{item.agent}</span>
                </div>
              ))}
            </div>

            <div className="h-4 w-px" style={{ backgroundColor: C.border }} />

            {/* Metrics */}
            <span className="text-[10px] tabular-nums" style={{ color: C.text }}>
              {PROJECT_SUMMARY.activeAgents} active
            </span>
            <span className="text-[10px] tabular-nums" style={{ color: C.text }}>
              {PROJECT_SUMMARY.completedWork}/{PROJECT_SUMMARY.totalWork} done
            </span>
            <span className="text-[10px] font-semibold tabular-nums" style={{ color: C.textBright }}>
              {formatCost(PROJECT_SUMMARY.totalCost)}
            </span>

            <div className="flex-1" />

            {/* Command input */}
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-1.5 max-w-[420px] flex-1"
              style={{ borderColor: C.border, backgroundColor: C.surface }}
            >
              <span className="text-[13px]" style={{ color: C.amber }}>&rsaquo;</span>
              <span className="text-[11px]" style={{ color: C.textDim }}>describe what you want done...</span>
              <span className="inline-block h-[13px] w-[6px] animate-pulse" style={{ backgroundColor: C.amber, opacity: 0.6 }} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
