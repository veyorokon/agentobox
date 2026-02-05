import {NodeSDK} from '@opentelemetry/sdk-node';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http';
import {resourceFromAttributes} from '@opentelemetry/resources';

const OTEL_ENABLED = process.env.OTEL_ENABLED !== 'false';

let _shutdown: (() => Promise<void>) | undefined;

if (OTEL_ENABLED) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': 'agentobox-server',
      'service.version': '0.1.0',
    }),
    traceExporter: new OTLPTraceExporter(), // defaults to localhost:4318
  });

  sdk.start();
  _shutdown = () => sdk.shutdown();
}

/** Flush and shut down the OTEL SDK. No-op when OTEL is disabled. */
export const shutdownOtel = _shutdown ?? (() => Promise.resolve());
