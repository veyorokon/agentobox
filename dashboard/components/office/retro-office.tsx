"use client"

import { useState } from "react"
import {
  MOCK_WORK_ITEMS,
  PROJECT_SUMMARY,
  type WorkItem,
  type WorkStatus,
} from "@/components/console/mock-data"

/* ================================================================== */
/*  PALETTE                                                            */
/* ================================================================== */

const P = {
  floor: "#1a1d23",
  grid: "#222630",
  zone: "#1e222a",
  zoneBorder: "#2d3340",
  zoneBorderDash: "4 3",
  label: "#4a5568",
  labelStamp: "#3d4555",
  text: "#8b95a5",
  textBright: "#c5cdd8",
  textDim: "#3d4555",
  desk: "#2a2f3a",
  deskTop: "#323844",
  monitor: "#0d1017",
  monitorGlow: "#1a3a2a",
  agent: {
    backend: { body: "#3a6b5a", head: "#4a8b6a", hue: 150 },
    infra: { body: "#6b5a3a", head: "#8b7a4a", hue: 35 },
    "test-runner": { body: "#5a3a6b", head: "#7a4a8b", hue: 280 },
    frontend: { body: "#3a5a6b", head: "#4a7a8b", hue: 195 },
    docs: { body: "#5a5a5a", head: "#7a7a7a", hue: 0 },
  } as Record<string, { body: string; head: string; hue: number }>,
  status: {
    active: "#8ec07c",
    "needs-you": "#d5a868",
    completed: "#6b7280",
    failed: "#d86c6c",
    blocked: "#d8b56a",
    queued: "#4b5563",
  } as Record<string, string>,
  card: {
    bg: "#2a2820",
    border: "#3d3828",
    activeBorder: "#8ec07c",
    needsBorder: "#d5a868",
  },
  amber: "#d5a868",
  green: "#8ec07c",
  red: "#d86c6c",
}

function statusColor(s: WorkStatus): string { return P.status[s] ?? P.status.queued }
function formatCost(c: number) { return c > 0 ? `$${c.toFixed(2)}` : "" }

/* ================================================================== */
/*  SVG PRIMITIVES                                                     */
/* ================================================================== */

function GridPattern() {
  return (
    <defs>
      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M 20 0 L 0 0 0 20" fill="none" stroke={P.grid} strokeWidth="0.5" />
      </pattern>
      <filter id="glow-amber">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="glow-green">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
  )
}

function ZoneLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x="-2" y="-10" width={text.length * 7.5 + 8} height="14" rx="1" fill={P.labelStamp} opacity="0.4" />
      <text
        fontFamily="monospace"
        fontSize="9"
        fontWeight="700"
        fill={P.label}
        letterSpacing="2"
        textAnchor="start"
        dominantBaseline="middle"
      >
        {text.toUpperCase()}
      </text>
    </g>
  )
}

function Desk({ x, y, w = 60, h = 36 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* desk surface */}
      <rect width={w} height={h} rx="2" fill={P.desk} stroke={P.zoneBorder} strokeWidth="0.5" />
      {/* desk top edge (depth cue) */}
      <rect y="0" width={w} height="3" rx="1" fill={P.deskTop} />
      {/* monitor */}
      <rect x={w / 2 - 14} y="6" width="28" height="18" rx="1" fill={P.monitor} stroke="#3a4050" strokeWidth="0.5" />
      {/* monitor stand */}
      <rect x={w / 2 - 3} y="24" width="6" height="4" rx="0.5" fill="#3a4050" />
    </g>
  )
}

/* ================================================================== */
/*  AGENT FIGURE                                                       */
/* ================================================================== */

function AgentFigure({
  x, y, name, activity, selected, onClick,
}: {
  x: number; y: number; name: string; activity: string; selected: boolean
  onClick: () => void
}) {
  const colors = P.agent[name] ?? P.agent.docs
  const sc = statusColor(
    activity === "coding" || activity === "browsing" ? "active"
    : activity === "blocked" || activity === "needs-you" ? "needs-you"
    : activity === "done" ? "completed"
    : "queued"
  )

  const isActive = activity === "coding" || activity === "thinking" || activity === "browsing"
  const needsYou = activity === "blocked" || activity === "needs-you"

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onClick={onClick}
      style={{ cursor: "pointer" }}
    >
      {/* Selection ring */}
      {selected && (
        <circle cx="8" cy="6" r="14" fill="none" stroke={P.amber} strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" />
      )}

      {/* Status halo */}
      {needsYou && (
        <circle cx="8" cy="6" r="12" fill="none" stroke={P.amber} strokeWidth="1" opacity="0.5" filter="url(#glow-amber)">
          <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
      {isActive && (
        <circle cx="8" cy="6" r="11" fill="none" stroke={P.green} strokeWidth="0.8" opacity="0.3" filter="url(#glow-green)">
          <animate attributeName="opacity" values="0.15;0.4;0.15" dur="3s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Body — simple rectangle */}
      <rect x="2" y="8" width="12" height="14" rx="2" fill={colors.body} />

      {/* Head — circle */}
      <circle cx="8" cy="4" r="5" fill={colors.head} />

      {/* State indicator */}
      {activity === "coding" && (
        <g>
          <rect x="15" y="10" width="3" height="1" fill={P.green} opacity="0.7">
            <animate attributeName="opacity" values="0.3;1;0.3" dur="0.8s" repeatCount="indefinite" />
          </rect>
          <rect x="15" y="13" width="5" height="1" fill={P.green} opacity="0.5">
            <animate attributeName="opacity" values="0.5;1;0.5" dur="1.1s" repeatCount="indefinite" />
          </rect>
          <rect x="15" y="16" width="2" height="1" fill={P.green} opacity="0.6">
            <animate attributeName="opacity" values="0.2;0.8;0.2" dur="0.9s" repeatCount="indefinite" />
          </rect>
        </g>
      )}
      {activity === "thinking" && (
        <text x="14" y="2" fontFamily="monospace" fontSize="8" fill={P.text} opacity="0.6">
          <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2s" repeatCount="indefinite" />
          ...
        </text>
      )}
      {activity === "done" && (
        <text x="4" y="-2" fontFamily="monospace" fontSize="8" fill={P.green}>{"\u2713"}</text>
      )}
      {needsYou && (
        <text x="5" y="-2" fontFamily="monospace" fontSize="9" fontWeight="bold" fill={P.amber}>!</text>
      )}

      {/* Name label */}
      <text
        x="8" y="30"
        fontFamily="monospace"
        fontSize="7"
        fill={P.text}
        textAnchor="middle"
      >
        @{name}
      </text>
    </g>
  )
}

/* ================================================================== */
/*  TASK TICKET                                                        */
/* ================================================================== */

function TaskTicket({
  x, y, title, status, agent, selected, onClick,
}: {
  x: number; y: number; title: string; status: string; agent?: string
  selected: boolean; onClick: () => void
}) {
  const sc = P.status[status] ?? P.status.queued
  const isNeedsYou = status === "needs-you"

  return (
    <g transform={`translate(${x}, ${y})`} onClick={onClick} style={{ cursor: "pointer" }}>
      {/* Card body */}
      <rect width="56" height="22" rx="2" fill={P.card.bg} stroke={selected ? P.amber : P.card.border} strokeWidth={selected ? "1.5" : "0.5"} />
      {/* Status left bar */}
      <rect width="3" height="22" rx="1" fill={sc} />
      {/* Title */}
      <text x="6" y="10" fontFamily="monospace" fontSize="5.5" fill={P.textBright} dominantBaseline="middle">
        {title.length > 12 ? title.slice(0, 11) + "\u2026" : title}
      </text>
      {/* Agent dot + cost line */}
      {agent && (
        <circle cx="8" cy="17" r="2" fill={P.agent[agent]?.body ?? P.textDim} />
      )}
      <text x="12" y="18" fontFamily="monospace" fontSize="4.5" fill={P.textDim} dominantBaseline="middle">
        {agent ? `@${agent}` : "unassigned"}
      </text>
      {/* Needs-you glow */}
      {isNeedsYou && (
        <rect width="56" height="22" rx="2" fill="none" stroke={P.amber} strokeWidth="1" opacity="0.4" filter="url(#glow-amber)">
          <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2s" repeatCount="indefinite" />
        </rect>
      )}
    </g>
  )
}

/* ================================================================== */
/*  EXECUTION PANEL (overlay)                                          */
/* ================================================================== */

function ExecutionPanel({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const agentColors = P.agent[item.agent] ?? P.agent.docs

  return (
    <div
      className="absolute right-0 top-0 bottom-0 flex flex-col border-l"
      style={{
        width: "42%",
        backgroundColor: "var(--p-surface, #141720)",
        borderColor: P.zoneBorder,
        zIndex: 20,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 border-b" style={{ height: 36, borderColor: P.zoneBorder }}>
        <div className="h-3 w-3 rounded-full" style={{ backgroundColor: agentColors.body }} />
        <span className="font-mono text-[11px] font-semibold" style={{ color: P.textBright }}>
          @{item.agent}
        </span>
        <span className="font-mono text-[10px]" style={{ color: P.text }}>{item.id} — {item.title}</span>
        <div className="flex-1" />
        <span className="font-mono text-[10px]" style={{ color: P.textDim }}>{item.turns} turns · {item.elapsed}</span>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[10px] px-2 py-0.5 rounded border transition-colors"
          style={{ borderColor: P.zoneBorder, color: P.text }}
        >
          ESC
        </button>
      </div>

      {/* Terminal output */}
      <div className="flex-1 overflow-y-auto p-4" style={{ backgroundColor: P.monitor }}>
        {item.terminalOutput && item.terminalOutput.length > 0 ? (
          <pre className="font-mono text-[11px] leading-[1.7] whitespace-pre-wrap" style={{ color: P.text }}>
            {item.terminalOutput.map((line, i) => {
              const clean = line.replace(/\x1b\[[0-9;]*m/g, "")
              const isDim = line.includes("\x1b[2m")
              const isGreen = line.includes("\x1b[32m")
              const isYellow = line.includes("\x1b[33m")
              return (
                <span key={i} className="block" style={{
                  color: isGreen ? P.green : isYellow ? P.amber : isDim ? P.textDim : P.text,
                }}>
                  {clean || "\u00A0"}
                </span>
              )
            })}
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="font-mono text-[11px]" style={{ color: P.textDim }}>
              {item.status === "queued" ? "awaiting execution" : "no output"}
            </span>
          </div>
        )}
      </div>

      {/* Task progress footer */}
      <div className="flex items-center gap-3 px-4 border-t" style={{ height: 32, borderColor: P.zoneBorder }}>
        {item.tasks.map(task => (
          <span key={task.id} className="font-mono text-[9px]" style={{
            color: task.status === "done" ? P.green : task.status === "active" ? P.amber : P.textDim,
          }}>
            {task.status === "done" ? "\u2713" : task.status === "active" ? "\u25b8" : "\u00b7"} {task.title.length > 15 ? task.title.slice(0, 14) + "\u2026" : task.title}
          </span>
        ))}
        <div className="flex-1" />
        <span className="font-mono text-[11px] font-bold tabular-nums" style={{ color: P.textBright }}>{formatCost(item.cost)}</span>
      </div>
    </div>
  )
}

/* ================================================================== */
/*  MAIN: RETRO OFFICE                                                 */
/* ================================================================== */

export function RetroOffice() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = selectedId ? MOCK_WORK_ITEMS.find(i => i.id === selectedId) : null

  // Map agents to desk positions in terminal bay
  const agentDesks: Record<string, { x: number; y: number }> = {
    backend: { x: 60, y: 300 },
    frontend: { x: 200, y: 300 },
    "test-runner": { x: 340, y: 300 },
    infra: { x: 60, y: 400 },
    docs: { x: 200, y: 400 },
  }

  // Map work items to their zones
  const activeItems = MOCK_WORK_ITEMS.filter(i => i.status === "active")
  const needsYouItems = MOCK_WORK_ITEMS.filter(i => i.status === "needs-you")
  const completedItems = MOCK_WORK_ITEMS.filter(i => i.status === "completed")
  const queuedItems = MOCK_WORK_ITEMS.filter(i => i.status === "queued")

  return (
    <div className="relative h-screen overflow-hidden" style={{ backgroundColor: P.floor }}>
      {/* Status bar */}
      <div
        className="flex items-center gap-4 px-4 border-b"
        style={{ height: 36, borderColor: P.zoneBorder, backgroundColor: "#15181e" }}
      >
        <span className="font-mono text-[12px] font-bold tracking-wide" style={{ color: P.textDim }}>
          {PROJECT_SUMMARY.name}
        </span>
        <div className="h-3 w-px" style={{ backgroundColor: P.zoneBorder }} />
        <span className="font-mono text-[10px]" style={{ color: P.text }}>
          {PROJECT_SUMMARY.activeAgents} active
        </span>
        <span className="font-mono text-[10px]" style={{ color: P.text }}>
          {PROJECT_SUMMARY.completedWork}/{PROJECT_SUMMARY.totalWork} done
        </span>
        <span className="font-mono text-[10px]" style={{ color: P.textBright }}>
          {formatCost(PROJECT_SUMMARY.totalCost)}
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color: P.textDim }}>
          retro office · concept
        </span>
      </div>

      {/* Office floor SVG */}
      <svg
        viewBox="0 0 800 560"
        className="w-full"
        style={{ height: "calc(100vh - 36px)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <GridPattern />

        {/* Floor background with grid */}
        <rect width="800" height="560" fill="url(#grid)" />

        {/* ── INTAKE ZONE (top-left) ──────────────────────── */}
        <g>
          <rect x="10" y="10" width="240" height="150" rx="4" fill={P.zone} stroke={P.zoneBorder} strokeWidth="1" strokeDasharray={P.zoneBorderDash} />
          <ZoneLabel x={20} y={28} text="intake" />

          {/* Inbox tray */}
          <rect x="30" y="50" width="80" height="12" rx="2" fill={P.desk} stroke={P.zoneBorder} strokeWidth="0.5" />
          <text x="70" y="59" fontFamily="monospace" fontSize="6" fill={P.textDim} textAnchor="middle">INBOX</text>

          {/* Queued work tickets stacked */}
          {queuedItems.map((item, i) => (
            <TaskTicket
              key={item.id}
              x={30 + i * 8}
              y={75 + i * 28}
              title={item.title}
              status={item.status}
              agent={item.agent}
              selected={selectedId === item.id}
              onClick={() => setSelectedId(item.id)}
            />
          ))}
        </g>

        {/* ── PLANNING ZONE (top-center) ──────────────────── */}
        <g>
          <rect x="260" y="10" width="270" height="150" rx="4" fill={P.zone} stroke={P.zoneBorder} strokeWidth="1" strokeDasharray={P.zoneBorderDash} />
          <ZoneLabel x={270} y={28} text="planning" />

          {/* Lead desk */}
          <Desk x={280} y={45} w={70} h={40} />

          {/* Task board */}
          <rect x="370" y="40" width="140" height="100" rx="3" fill="#1c2028" stroke={P.zoneBorder} strokeWidth="0.5" />
          <text x="440" y="52" fontFamily="monospace" fontSize="5" fill={P.textDim} textAnchor="middle">TASK BOARD</text>

          {/* Active task cards on the board */}
          {activeItems.map((item, i) => (
            <TaskTicket
              key={item.id}
              x={378 + (i % 2) * 62}
              y={58 + Math.floor(i / 2) * 28}
              title={item.title}
              status={item.status}
              agent={item.agent}
              selected={selectedId === item.id}
              onClick={() => setSelectedId(item.id)}
            />
          ))}
        </g>

        {/* ── REVIEW ZONE (top-right) ─────────────────────── */}
        <g>
          <rect x="540" y="10" width="250" height="150" rx="4" fill={P.zone} stroke={needsYouItems.length > 0 ? P.amber : P.zoneBorder} strokeWidth={needsYouItems.length > 0 ? "1.5" : "1"} strokeDasharray={P.zoneBorderDash}>
            {needsYouItems.length > 0 && (
              <animate attributeName="stroke-opacity" values="0.4;0.9;0.4" dur="2.5s" repeatCount="indefinite" />
            )}
          </rect>
          <ZoneLabel x={550} y={28} text="review" />

          {/* Approval tray */}
          <rect x="560" y="45" width="100" height="14" rx="2" fill={P.desk} stroke={needsYouItems.length > 0 ? P.amber : P.zoneBorder} strokeWidth="0.5" />
          <text x="610" y="55" fontFamily="monospace" fontSize="6" fill={needsYouItems.length > 0 ? P.amber : P.textDim} textAnchor="middle">
            APPROVALS {needsYouItems.length > 0 ? `(${needsYouItems.length})` : ""}
          </text>

          {needsYouItems.map((item, i) => (
            <TaskTicket
              key={item.id}
              x={560 + i * 8}
              y={68 + i * 28}
              title={item.title}
              status={item.status}
              agent={item.agent}
              selected={selectedId === item.id}
              onClick={() => setSelectedId(item.id)}
            />
          ))}
        </g>

        {/* ── TERMINAL BAY (bottom-left, largest) ─────────── */}
        <g>
          <rect x="10" y="170" width="520" height="280" rx="4" fill={P.zone} stroke={P.zoneBorder} strokeWidth="1" strokeDasharray={P.zoneBorderDash} />
          <ZoneLabel x={20} y={188} text="terminal bay" />

          {/* Desks with agents */}
          {Object.entries(agentDesks).map(([name, pos]) => {
            const workItem = MOCK_WORK_ITEMS.find(i => i.agent === name)
            const activity = workItem?.status === "active" ? "coding"
              : workItem?.status === "needs-you" ? "needs-you"
              : workItem?.status === "completed" ? "done"
              : "idle"

            return (
              <g key={name}>
                <Desk x={pos.x} y={pos.y - 50} w={70} h={40} />
                {/* Monitor glow for active agents */}
                {activity === "coding" && (
                  <rect x={pos.x + 21} y={pos.y - 44} width="28" height="18" rx="1" fill={P.monitorGlow} opacity="0.4">
                    <animate attributeName="opacity" values="0.3;0.6;0.3" dur="2s" repeatCount="indefinite" />
                  </rect>
                )}
                <AgentFigure
                  x={pos.x + 27}
                  y={pos.y}
                  name={name}
                  activity={activity}
                  selected={selectedId === workItem?.id}
                  onClick={() => workItem && setSelectedId(workItem.id)}
                />
              </g>
            )
          })}
        </g>

        {/* ── ARCHIVE ZONE (bottom-right) ─────────────────── */}
        <g>
          <rect x="540" y="170" width="250" height="280" rx="4" fill={P.zone} stroke={P.zoneBorder} strokeWidth="1" strokeDasharray={P.zoneBorderDash} />
          <ZoneLabel x={550} y={188} text="archive" />

          {/* File shelves */}
          {[0, 1, 2].map(row => (
            <g key={row}>
              <rect x="560" y={210 + row * 60} width="210" height="8" rx="1" fill={P.desk} />
              <text x="565" y={206 + row * 60} fontFamily="monospace" fontSize="5" fill={P.textDim}>
                {row === 0 ? "completed" : row === 1 ? "artifacts" : "history"}
              </text>
            </g>
          ))}

          {/* Completed work as folders */}
          {completedItems.map((item, i) => (
            <g key={item.id} onClick={() => setSelectedId(item.id)} style={{ cursor: "pointer" }}>
              {/* Folder shape */}
              <rect x={570 + i * 50} y={218} width="38" height="30" rx="2" fill="#2a2820" stroke={selectedId === item.id ? P.amber : "#3d3828"} strokeWidth={selectedId === item.id ? "1.5" : "0.5"} />
              <rect x={570 + i * 50} y={215} width="18" height="5" rx="1" fill="#3d3828" />
              <text x={589 + i * 50} y={238} fontFamily="monospace" fontSize="5" fill={P.text} textAnchor="middle">
                {item.id}
              </text>
              <text x={589 + i * 50} y={244} fontFamily="monospace" fontSize="4" fill={P.textDim} textAnchor="middle">
                {formatCost(item.cost)}
              </text>
            </g>
          ))}

          {/* Artifact items on second shelf */}
          {MOCK_WORK_ITEMS.filter(i => i.artifacts.length > 0).slice(0, 4).flatMap((item, wi) =>
            item.artifacts.slice(0, 2).map((art, ai) => (
              <g key={`${item.id}-${ai}`}>
                <rect x={570 + (wi * 2 + ai) * 28} y={278} width="24" height="18" rx="1" fill="#1c2028" stroke={P.zoneBorder} strokeWidth="0.5" />
                <text x={582 + (wi * 2 + ai) * 28} y={289} fontFamily="monospace" fontSize="4" fill={P.textDim} textAnchor="middle">
                  {(art.path.split("/").pop() ?? "").slice(0, 8)}
                </text>
              </g>
            ))
          )}
        </g>

        {/* ── FLOW ARROWS between zones ───────────────────── */}
        <g opacity="0.15" stroke={P.text} strokeWidth="1" fill="none" markerEnd="url(#arrowhead)">
          <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <path d="M 0 0 L 6 2 L 0 4" fill={P.text} />
            </marker>
          </defs>
          {/* intake → planning */}
          <path d="M 250 85 L 260 85" />
          {/* planning → terminal bay */}
          <path d="M 395 160 L 395 170" />
          {/* terminal bay → review */}
          <path d="M 530 85 L 540 85" />
          {/* review → archive */}
          <path d="M 665 160 L 665 170" />
        </g>
      </svg>

      {/* Execution panel overlay */}
      {selected && (
        <>
          {/* Dim overlay */}
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(0,0,0,0.3)", zIndex: 15 }}
            onClick={() => setSelectedId(null)}
          />
          <ExecutionPanel item={selected} onClose={() => setSelectedId(null)} />
        </>
      )}

      {/* Intervention bar */}
      {MOCK_WORK_ITEMS.some(i => i.intervention) && !selected && (
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center gap-3 px-4 border-t"
          style={{ height: 38, borderColor: P.amber, backgroundColor: `color-mix(in srgb, ${P.amber} 5%, ${P.floor})`, zIndex: 10 }}
        >
          {(() => {
            const item = MOCK_WORK_ITEMS.find(i => i.intervention)!
            const inv = item.intervention!
            return (
              <>
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: P.agent[item.agent]?.body ?? P.textDim }}>
                  <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" />
                </div>
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: P.amber }}>{item.id}</span>
                <span className="font-mono text-[11px]" style={{ color: P.text }}>{inv.type}:</span>
                <span className="font-mono text-[11px] flex-1 truncate" style={{ color: P.textBright }}>{inv.summary}</span>
                {inv.options?.map(opt => (
                  <button key={opt} type="button" className="font-mono rounded border px-3 py-1 text-[10px] font-semibold"
                    style={{ borderColor: opt === "Allow" ? P.green : P.zoneBorder, color: opt === "Allow" ? P.green : P.text, backgroundColor: "transparent" }}>
                    {opt}
                  </button>
                ))}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
