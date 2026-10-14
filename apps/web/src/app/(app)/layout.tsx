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
    <div className="min-h-dvh lg:pl-[248px]">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <AppNav isAdmin={user.role === "admin"} name={user.name} />
      <ProviderBanner status={status} isAdmin={user.role === "admin"} />
      <TimezoneSync needsTimezone={settings.timezone === null} />
      <main
        id="main-content"
        tabIndex={-1}
        className="workspace-main mx-auto w-full max-w-[76rem] px-5 py-8 outline-none sm:px-8 lg:px-10 lg:py-10"
      >
        {children}
      </main>
    </div>
  );
}
