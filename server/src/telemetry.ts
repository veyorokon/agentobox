import {trace, SpanStatusCode, type Span} from '@opentelemetry/api';

export const tracer = trace.getTracer('agentobox-server', '0.1.0');

/**
 * Run an async function inside an OTEL span.
 * Errors are recorded on the span and re-thrown.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, {attributes}, async (span) => {
    try {
      const result = await fn(span);
      return result;
    } catch (err) {
      span.setStatus({code: SpanStatusCode.ERROR, message: String(err)});
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}
