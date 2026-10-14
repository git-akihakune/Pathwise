export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  const { loadBaseConfig } = await import("@pathwise/core/config");
  const { startTelemetry } = await import("@pathwise/core/telemetry");
  await startTelemetry(loadBaseConfig(), "pathwise-web");
}
