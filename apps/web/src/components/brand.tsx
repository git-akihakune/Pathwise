import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-3 font-heading text-xl font-bold tracking-tight",
        className,
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 19V12a4 4 0 0 1 4-4h4a4 4 0 0 0 4-4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="6" cy="19" r="2.5" fill="currentColor" />
          <circle cx="12" cy="8" r="2.5" fill="currentColor" />
          <circle cx="18" cy="4" r="2.5" fill="currentColor" />
        </svg>
      </span>
      Pathwise
    </span>
  );
}
