import type { MemoryItem } from "@pathwise/core/services/memory";
import { setMemoryStatusAction } from "@/app/(app)/profile/actions";
import { SourceLabel } from "@/components/source-label";
import { Button } from "@/components/ui/button";

export function PendingMemoryList({ items }: { items: MemoryItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="pending-memory" className="flex flex-col gap-2">
      <h2 id="pending-memory" className="text-lg font-medium">
        New things I learned
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-4 rounded-md border p-3"
          >
            <div className="flex flex-col gap-1">
              <span>{item.content}</span>
              <SourceLabel type={item.sourceType} />
            </div>
            <div className="flex gap-2">
              <form action={setMemoryStatusAction.bind(null, item.id, "active")}>
                <Button type="submit" size="sm">
                  Confirm
                </Button>
              </form>
              <form action={setMemoryStatusAction.bind(null, item.id, "rejected")}>
                <Button type="submit" variant="outline" size="sm">
                  Dismiss
                </Button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
