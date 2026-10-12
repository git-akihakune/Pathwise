"use client";

import { useEffect, useRef } from "react";
import { saveDetectedTimezoneAction } from "@/app/(app)/actions";

export function TimezoneSync({ needsTimezone }: { needsTimezone: boolean }) {
  const sent = useRef(false);
  useEffect(() => {
    if (!needsTimezone || sent.current) return;
    sent.current = true;
    void saveDetectedTimezoneAction(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [needsTimezone]);
  return null;
}
