import { getProviderStatusForUser } from "@pathwise/core/services/providers";
import { getUserSettings } from "@pathwise/core/services/settings";
import type { ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { ProviderBanner } from "@/components/provider-banner";
import { TimezoneSync } from "@/components/timezone-sync";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireSession();
  const { db } = getServer();
  const [settings, status] = await Promise.all([
    getUserSettings(db, user.userId),
    getProviderStatusForUser(db, user.userId),
  ]);
  return (
    <>
      <AppNav isAdmin={user.role === "admin"} />
      <ProviderBanner status={status} isAdmin={user.role === "admin"} />
      <TimezoneSync needsTimezone={settings.timezone === null} />
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </>
  );
}
