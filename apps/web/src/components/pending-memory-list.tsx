import type { MemoryItem } from "@pathwise/core/services/memory";
import { setMemoryStatusAction } from "@/app/(app)/profile/actions";
import { SourceLabel } from "@/components/source-label";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";

export function PendingMemoryList({ items }: { items: MemoryItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="pending-memory" className="workspace-section flex flex-col gap-4">
      <h2 id="pending-memory" className="font-heading text-lg font-semibold">
        New things I learned
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id} className="entity-row">
            <div className="flex flex-col gap-1">
              <span>{item.content}</span>
              <SourceLabel type={item.sourceType} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Form noValidate action={setMemoryStatusAction.bind(null, item.id, "active")}>
                <Button type="submit" size="sm">
                  Confirm
                </Button>
              </Form>
              <Form noValidate action={setMemoryStatusAction.bind(null, item.id, "rejected")}>
                <Button type="submit" variant="outline" size="sm">
                  Dismiss
                </Button>
              </Form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
