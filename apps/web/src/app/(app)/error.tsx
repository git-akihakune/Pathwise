"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function WorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    document.title = "Couldn't load this page | Pathwise";
  }, []);
  return (
    <EmptyState
      title="Couldn't load this page"
      description="Your workspace couldn't be loaded. Try again, or return to Today."
      action={
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={reset}>
            <RefreshCw aria-hidden="true" />
            Try again
          </Button>
          <Link
            href="/"
            className="text-sm font-semibold text-primary underline underline-offset-4"
          >
            Back to Today
          </Link>
        </div>
      }
    />
  );
}
