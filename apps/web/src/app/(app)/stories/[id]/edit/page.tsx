export const metadata = { title: "Edit story" };

import { NotFoundError } from "@pathwise/core/errors";
import { getStory } from "@pathwise/core/services/stories";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader } from "@/components/page-header";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";
import { StoryForm } from "../../story-form";

export default async function EditStoryPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const { userId } = await requireSession();
  const story = await getStory(getServer().db, userId, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Edit story"
        description="Keep your achievements accurate and ready to reuse."
      />
      <StoryForm story={story} />
    </div>
  );
}
