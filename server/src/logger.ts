import pino from 'pino';
import {trace, context} from '@opentelemetry/api';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  mixin() {
    const span = trace.getSpan(context.active());
    if (span) {
      const ctx = span.spanContext();
      return {traceId: ctx.traceId, spanId: ctx.spanId};
    }
    return {};
  },
  transport: {
    targets: [
      {
        target: 'pino-opentelemetry-transport',
        options: {resourceAttributes: {'service.name': 'agentobox-server'}},
        level: 'info',
      },
      ...(isDev
        ? [
            {
              target: 'pino-pretty',
              options: {colorize: true, ignore: 'pid,hostname', translateTime: 'HH:MM:ss.l'},
              level: 'debug',
            },
          ]
        : []),
    ],
  },
});

// Subsystem child loggers
export const dockerLog = logger.child({sub: 'docker'});
export const agentLog = logger.child({sub: 'agent'});
export const llmLog = logger.child({sub: 'llm'});
export const sseLog = logger.child({sub: 'sse'});
export const eventLog = logger.child({sub: 'event'});
