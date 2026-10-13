import { Wrench } from "lucide-react";
import { type ToolPart, toolLabel } from "./tool-labels";

export function ToolCard({ part }: { part: ToolPart }) {
  const label = toolLabel(part);
  if (!label) return null;
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Wrench aria-hidden className="size-3.5" />
      {label}
    </p>
  );
}
