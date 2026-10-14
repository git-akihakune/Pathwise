export const metadata = { title: "Stories" };

import { listStories } from "@pathwise/core/services/stories";
import Link from "next/link";
import { connection } from "next/server";
import { ConfirmDelete } from "@/components/confirm-delete";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SourceLabel } from "@/components/source-label";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";
import { deleteStoryAction } from "./actions";

const STAR = [
  ["situation", "Situation"],
  ["task", "Task"],
  ["action", "Action"],
  ["result", "Result"],
] as const;

export default async function StoriesPage() {
  await connection();
  const { userId } = await requireSession();
  const stories = await listStories(getServer().db, userId);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stories"
        description="Achievements captured once, ready to reuse."
        action={
          <Link href="/stories/new" className={buttonVariants()}>
            Add story
          </Link>
        }
      />
      {stories.length === 0 && (
        <EmptyState
          title="No stories yet."
          description="Add one, or tell your coach about something you're proud of."
        />
      )}
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        {stories.map((story) => (
          <article key={story.id} className="workspace-section flex flex-col gap-4">
            <h2 className="font-heading text-lg font-semibold">{story.title}</h2>
            <SourceLabel type={story.sourceType} />
            {story.skills.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {story.skills.map((skill) => (
                  <Badge key={skill} variant="secondary">
                    {skill}
                  </Badge>
                ))}
              </div>
            )}
            {story.metrics && <p className="text-sm">{story.metrics}</p>}
            {STAR.map(
              ([key, label]) =>
                story[key] && (
                  <p key={key} className="text-sm">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {label}
                    </span>{" "}
                    {story[key]}
                  </p>
                ),
            )}
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/stories/${story.id}/edit`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Edit
              </Link>
              <ConfirmDelete action={deleteStoryAction} fields={{ id: story.id }} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
