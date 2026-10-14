import { Compass } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-44 flex-col items-start justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 p-6">
      <span className="flex size-10 items-center justify-center rounded-xl border bg-card text-primary">
        <Compass className="size-5" aria-hidden="true" />
      </span>
      <p className="font-heading font-semibold">{title}</p>
      {description && (
        <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  );
}
