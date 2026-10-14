import { LoaderCircle } from "lucide-react";

export default function Loading() {
  return (
    <div
      role="status"
      className="workspace-section flex min-h-64 items-center justify-center gap-3 text-muted-foreground"
    >
      <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden="true" />
      Loading your workspace…
    </div>
  );
}
