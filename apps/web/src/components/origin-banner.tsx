"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { originMismatch } from "@/lib/origin";

export function OriginBanner({ appUrl }: { appUrl: string }) {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  if (!origin || !originMismatch(appUrl, origin)) return null;
  return (
    <Alert variant="destructive">
      This instance is configured for {appUrl}, but you opened it at {origin}. Sign-in will fail
      until you open {appUrl} or set APP_URL in .env to the address you use, then run docker compose
      up -d.
    </Alert>
  );
}
