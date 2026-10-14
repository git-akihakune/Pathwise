"use client";

import { useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** A failed compute step: retry it, or skip it and follow the manual hint instead. */
export function StepAttention({
  message,
  manualHint,
  retry,
  skip,
}: {
  message: string;
  manualHint: string;
  retry: () => Promise<void>;
  skip: () => Promise<void>;
}) {
  const [pending, start] = useTransition();
  return (
    <Alert variant="destructive" className="flex flex-col gap-2">
      <p>
        This step didn't finish. {message} {manualHint}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          aria-busy={pending}
          onClick={() => start(retry)}
        >
          Retry
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          aria-busy={pending}
          onClick={() => start(skip)}
        >
          Do it manually
        </Button>
      </div>
    </Alert>
  );
}
