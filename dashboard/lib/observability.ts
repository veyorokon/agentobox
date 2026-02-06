/**
 * Lightweight frontend observability — structured logging, timing, and trace propagation.
 * No heavy OTEL SDK. Ring buffer for debugging, W3C traceparent for correlation.
 *
 * Session trace_id is generated once at module load and used across all log entries
 * and outgoing requests. Per-operation span_ids are generated fresh.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  context: string;
  message: string;
  ts: number;
  attributes?: Record<string, unknown>;
  durationMs?: number;
  traceId: string;
  spanId?: string;
}

const RING_SIZE = 1000;
const ring: LogEntry[] = [];
let ringIndex = 0;

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable trace_id for the entire browser session. */
const sessionTraceId = randomHex(16);

/** Short prefix for console output (8 hex chars = visually scannable). */
const tracePrefix = sessionTraceId.slice(0, 8);

function push(entry: LogEntry) {
  ring[ringIndex % RING_SIZE] = entry;
  ringIndex++;

  const prefix = `[${tracePrefix}] [${entry.context}]`;
  const suffix = entry.durationMs != null ? ` (${entry.durationMs}ms)` : '';
  const msg = `${prefix} ${entry.message}${suffix}`;

  switch (entry.level) {
    case 'debug':
      console.debug(msg, entry.attributes ?? '');
      break;
    case 'info':
      console.info(msg, entry.attributes ?? '');
      break;
    case 'warn':
      console.warn(msg, entry.attributes ?? '');
      break;
    case 'error':
      console.error(msg, entry.attributes ?? '');
      break;
  }
}

function log(level: LogLevel, context: string, message: string, attributes?: Record<string, unknown>) {
  push({level, context, message, ts: Date.now(), traceId: sessionTraceId, attributes});
}

/**
 * Time an async operation, auto-log start/end/error.
 * Each span gets a unique span_id for fine-grained correlation.
 */
async function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const spanId = randomHex(8);
  const start = Date.now();
  try {
    const result = await fn();
    push({level: 'info', context: name, message: 'completed', ts: Date.now(), durationMs: Date.now() - start, traceId: sessionTraceId, spanId});
    return result;
  } catch (err) {
    push({
      level: 'error',
      context: name,
      message: err instanceof Error ? err.message : String(err),
      ts: Date.now(),
      durationMs: Date.now() - start,
      traceId: sessionTraceId,
      spanId,
    });
    throw err;
  }
}

/**
 * Generate W3C traceparent header for cross-boundary correlation.
 * Uses the stable session trace_id with a fresh span_id per call.
 * Format: 00-{traceId}-{spanId}-01
 */
function getTraceHeaders(): Record<string, string> {
  const spanId = randomHex(8);
  return {traceparent: `00-${sessionTraceId}-${spanId}-01`};
}

/** Get the last N log entries (most recent first). */
function getRecentLogs(n = 50): LogEntry[] {
  const entries: LogEntry[] = [];
  const total = Math.min(ringIndex, RING_SIZE);
  const count = Math.min(n, total);
  for (let i = 0; i < count; i++) {
    let idx = ringIndex - 1 - i;
    while (idx < 0) idx += RING_SIZE;
    entries.push(ring[idx % RING_SIZE]);
  }
  return entries;
}

export const logger = {
  debug: (context: string, message: string, attributes?: Record<string, unknown>) => log('debug', context, message, attributes),
  info: (context: string, message: string, attributes?: Record<string, unknown>) => log('info', context, message, attributes),
  warn: (context: string, message: string, attributes?: Record<string, unknown>) => log('warn', context, message, attributes),
  error: (context: string, message: string, attributes?: Record<string, unknown>) => log('error', context, message, attributes),
  withSpan,
  getTraceHeaders,
  getRecentLogs,
  /** The session trace_id for external use (e.g. error reporting). */
  sessionTraceId,
};
