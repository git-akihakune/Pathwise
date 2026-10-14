"use client";

import type { CoachUIMessage } from "@pathwise/core/services/sessions";
import { Markdown } from "@/components/markdown";
import { ProposalCard, type ProposalView } from "@/components/proposal-card";
import { PathsCard, type PathsOutput } from "./paths-card";
import { ToolCard } from "./tool-card";
import { isProposalTool, type ToolPart, toolName } from "./tool-labels";

type Part = CoachUIMessage["parts"][number];

/** crypto.randomUUID needs a secure context; self-hosted instances may be served over plain http. */
export const uuid = (): string =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (
          Number(c) ^
          ((crypto.getRandomValues(new Uint8Array(1))[0] ?? 0) & (15 >> (Number(c) / 4)))
        ).toString(16),
      );

export function MessagePart({
  part,
  role,
  proposals,
  send,
  busy,
}: {
  part: Part;
  role: CoachUIMessage["role"];
  proposals: Record<string, ProposalView>;
  send: (text: string) => void;
  busy: boolean;
}) {
  if (part.type === "text") {
    return role === "user" ? (
      <p className="whitespace-pre-wrap">{part.text}</p>
    ) : (
      <Markdown>{part.text}</Markdown>
    );
  }
  if (!part.type.startsWith("tool-")) return null;
  const tool = part as ToolPart;
  const name = toolName(tool);
  if (isProposalTool(name)) {
    if (tool.state === "output-error") return <p className="text-sm">{tool.errorText}</p>;
    if (tool.state !== "output-available") {
      return <p className="text-sm text-muted-foreground">Preparing a suggestion…</p>;
    }
    const id = (tool.output as { proposalId?: string } | undefined)?.proposalId;
    return id ? <ProposalCard proposalId={id} initial={proposals[id]} onRegenerate={send} /> : null;
  }
  if (name === "generateCareerPaths" && tool.state === "output-available") {
    return <PathsCard output={tool.output as PathsOutput} onSave={send} disabled={busy} />;
  }
  return <ToolCard part={tool} />;
}
