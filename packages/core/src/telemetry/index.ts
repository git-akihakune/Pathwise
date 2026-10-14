import { OpenTelemetry } from "@ai-sdk/otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerTelemetry, type Telemetry } from "ai";
import type { BaseConfig } from "../config";
import { createLogger } from "../logger";

export function otlpTracesUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/v1/traces`;
}

function redactedError(): Error {
  const error = new Error("Content omitted");
  error.stack = undefined;
  return error;
}

export function contentFree(inner: Telemetry): Telemetry {
  return new Proxy(inner, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (
        (typeof key === "string" && /^(on|experimental_on)[A-Z]/.test(key)) ||
        key === "executeTool" ||
        key === "executeLanguageModelCall"
      ) {
        return (event: object) => {
          const copy = Object.assign(Object.create(Object.getPrototypeOf(event)), event, {
            recordInputs: false,
            recordOutputs: false,
          });
          // The integration records exceptions independently of recordInputs/recordOutputs.
          // Redact only the telemetry copy; callers still receive the original error.
          if (key === "onError") copy.error = redactedError();
          if (copy.toolOutput?.type === "tool-error") {
            copy.toolOutput = { ...copy.toolOutput, error: redactedError() };
          }
          if (Array.isArray(copy.content)) {
            copy.content = copy.content.map((part: { type: string }) =>
              part.type === "tool-error" ? { ...part, error: redactedError() } : part,
            );
          }
          return value.call(target, copy);
        };
      }
      return value.bind(target);
    },
  });
}

export async function startTelemetry(
  config: Pick<BaseConfig, "otelEndpoint" | "logContent">,
  serviceName: string,
): Promise<(() => Promise<void>) | null> {
  if (!config.otelEndpoint) return null;
  const log = createLogger("telemetry");
  try {
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({ "service.name": serviceName }),
      spanProcessors: [
        new BatchSpanProcessor(new OTLPTraceExporter({ url: otlpTracesUrl(config.otelEndpoint) })),
      ],
    });
    const integration = new OpenTelemetry({ tracer: provider.getTracer("pathwise") });
    registerTelemetry(config.logContent ? integration : contentFree(integration));
    log.info({ serviceName, contentRecorded: config.logContent }, "tracing enabled");
    return () => provider.shutdown();
  } catch (err) {
    log.warn({ err }, "tracing disabled: failed to start");
    return null;
  }
}
