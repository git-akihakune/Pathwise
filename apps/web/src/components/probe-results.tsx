import type { ProbeChecks, ProviderStatus } from "@pathwise/core/llm";

const ROWS: { key: keyof ProbeChecks; label: string }[] = [
  { key: "basic", label: "Basic reply" },
  { key: "streaming", label: "Streaming" },
  { key: "tools", label: "Tool calling" },
  { key: "jsonSchema", label: "Structured output (JSON schema)" },
];

const SUMMARY: Record<ProviderStatus, string> = {
  full: "Full support. All coach features are available.",
  degraded:
    "Limited support. The coach works, but without tool calling or native structured output it relies on fallbacks.",
  unsupported:
    "This provider can't be activated: it must pass the basic reply and streaming checks.",
  untested: "",
};

export function ProbeResults({
  label,
  status,
  checks,
}: {
  label: string;
  status: ProviderStatus;
  checks: ProbeChecks;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <h3 className="font-medium">Test results for {label}</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {ROWS.map(({ key, label: name }) => (
          <li key={key} className="flex flex-wrap gap-2">
            <span className="w-64">{name}</span>
            {checks[key].ok ? (
              <span>Passed</span>
            ) : (
              <span className="text-destructive">Failed: {checks[key].error}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">{SUMMARY[status]}</p>
    </div>
  );
}
