/* ================================================================== */
/*  UNIFIED LOGGER                                                      */
/*                                                                      */
/*  Every log call builds a structured LogEntry (JSON-serializable).    */
/*  Sinks decide what to do with it:                                    */
/*  - consoleSink: pretty-print with colors (dev)                      */
/*  - Add more sinks for prod: OTel, Datadog, custom HTTP, etc.        */
/*                                                                      */
/*  Gate: NEXT_PUBLIC_DEBUG=1                                           */
/*                                                                      */
/*  Usage:                                                              */
/*    const log = createLogger("apollo")                                */
/*    log("cache.modify", { typename: "Agent", id: "1" })              */
/*    log("query.error", { message: "..." }, "error")                  */
/* ================================================================== */

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LogEntry {
  ts: string
  ns: string
  action: string
  level: LogLevel
  detail?: unknown
}

export type LogSink = (entry: LogEntry) => void

/* ── Gate ─────────────────────────────────────────────────────────── */

const ENABLED = typeof window !== "undefined" && process.env.NEXT_PUBLIC_DEBUG === "1"

/* ── Console sink (dev) ──────────────────────────────────────────── */

const LEVEL_FN: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
}

const NS_COLORS: Record<string, string> = {
  apollo: "#7c3aed",
  zustand: "#059669",
  router: "#0284c7",
  error: "#dc2626",
}

const consoleSink: LogSink = (entry) => {
  const color = NS_COLORS[entry.ns] ?? "#6b7280"
  const style = `color: ${color}; font-weight: bold`
  const fn = LEVEL_FN[entry.level]

  if (entry.detail !== undefined) {
    fn(`%c[${entry.ns}]`, style, entry.action, entry.detail)
  } else {
    fn(`%c[${entry.ns}]`, style, entry.action)
  }
}

/* ── Sink registry ───────────────────────────────────────────────── */

const sinks: LogSink[] = [consoleSink]

export function addSink(sink: LogSink) {
  sinks.push(sink)
}

/* ── Factory ─────────────────────────────────────────────────────── */

export function createLogger(namespace: string) {
  return function log(action: string, detail?: unknown, level: LogLevel = "debug") {
    if (!ENABLED) return

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      ns: namespace,
      action,
      level,
      ...(detail !== undefined && { detail }),
    }

    for (const sink of sinks) sink(entry)
  }
}
