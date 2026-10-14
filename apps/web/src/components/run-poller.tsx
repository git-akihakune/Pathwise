"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While `active`, re-checks the run through `refresh` every 2 s, then re-renders the page. */
export function RunPoller({ active, refresh }: { active: boolean; refresh: () => Promise<void> }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const id = setInterval(() => {
      refresh()
        .catch(() => {})
        .finally(() => {
          if (!stopped) router.refresh();
        });
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [active, refresh, router]);
  return null;
}
