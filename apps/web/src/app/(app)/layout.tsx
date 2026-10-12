import type { ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireSession();
  return (
    <>
      <AppNav isAdmin={user.role === "admin"} />
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </>
  );
}
