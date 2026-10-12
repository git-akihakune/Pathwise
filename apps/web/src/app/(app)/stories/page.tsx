import { listStories } from "@pathwise/core/services/stories";
import Link from "next/link";
import { connection } from "next/server";
import { ConfirmDelete } from "@/components/confirm-delete";
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
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Stories</h1>
          <p className="text-muted-foreground">Achievements captured once, ready to reuse.</p>
        </div>
        <Link href="/stories/new" className={buttonVariants()}>
          Add story
        </Link>
      </header>
      {stories.length === 0 && (
        <p className="text-muted-foreground">
          No stories yet. Add one, or tell your coach about something you're proud of.
        </p>
      )}
      {stories.map((story) => (
        <article key={story.id} className="flex flex-col gap-3 rounded-md border p-4">
          <h2 className="text-lg font-medium">{story.title}</h2>
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
                  <span className="font-medium">{label}</span>: {story[key]}
                </p>
              ),
          )}
          <div className="flex gap-2">
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
  );
}
