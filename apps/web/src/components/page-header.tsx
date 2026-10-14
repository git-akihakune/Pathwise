import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  eyebrow = "Your career workspace",
  action,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
      <div className="min-w-0 max-w-2xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          {eyebrow}
        </p>
        <h1 className="font-heading text-[1.75rem] leading-tight font-semibold tracking-tight sm:text-[2.1rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </header>
  );
}
