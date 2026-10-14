/** The fields of a tool UI part the chat reads (AI SDK `tool-{name}` parts). */
export interface ToolPart {
  type: `tool-${string}`;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

const SOURCES: Record<string, string> = { onet: "O*NET", esco: "ESCO" };

export const toolName = (part: Pick<ToolPart, "type">) => part.type.slice("tool-".length);
export const isProposalTool = (name: string) => name.startsWith("propose");

const field = (value: unknown, key: string): string =>
  value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string"
    ? ((value as Record<string, unknown>)[key] as string)
    : "";

type Labels = { running: (p: ToolPart) => string; done: (p: ToolPart) => string; failed: string };

const LABELS: Record<string, Labels> = {
  getOccupation: {
    running: (p) => `Looking up ${field(p.input, "idOrCode")}…`,
    done: (p) =>
      `Looked up: ${field(p.output, "title")} (${SOURCES[field(p.output, "source")] ?? ""} ${field(p.output, "code")})`,
    failed: "Lookup failed",
  },
  searchOccupations: {
    running: (p) => `Searching occupations: “${field(p.input, "query")}”…`,
    done: (p) => `Searched occupations: “${field(p.input, "query")}”`,
    failed: "Search failed",
  },
  searchMemory: {
    running: () => "Checking my notes…",
    done: () => "Checked my notes",
    failed: "Couldn't check my notes",
  },
  getPlan: {
    running: () => "Looking at your plan…",
    done: () => "Looked at your plan",
    failed: "Couldn't load your plan",
  },
  generateCareerPaths: {
    running: () => "Drafting career paths…",
    done: () => "Drafted career paths",
    failed: "Couldn't draft career paths",
  },
};

/** One-line status for a lookup tool; null for proposal tools (they get a card) and unknown tools. */
export function toolLabel(part: ToolPart): string | null {
  const labels = LABELS[toolName(part)];
  if (!labels) return null;
  if (part.state === "output-available") return labels.done(part);
  if (part.state === "output-error") return `${labels.failed}: ${part.errorText ?? ""}`.trim();
  return labels.running(part);
}
