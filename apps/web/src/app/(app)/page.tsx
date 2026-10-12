import { listMemory } from "@pathwise/core/services/memory";
import Link from "next/link";
import { PendingMemoryList } from "@/components/pending-memory-list";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";

export default async function TodayPage() {
  const { name, userId } = await requireSession();
  const pending = await listMemory(getServer().db, userId, { status: ["pending"] });
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Welcome, {name}</h1>
      <p className="text-muted-foreground">Pick up where you left off with your coach.</p>
      <Link href="/coach" className="underline">
        Open Coach
      </Link>
      <PendingMemoryList items={pending} />
    </section>
  );
}
