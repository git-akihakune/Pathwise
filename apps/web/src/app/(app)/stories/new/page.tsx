export const metadata = { title: "Add story" };

import { PageHeader } from "@/components/page-header";
import { StoryForm } from "../story-form";

export default function NewStoryPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="New story"
        description="Capture what happened, what you did, and the difference it made."
      />
      <StoryForm />
    </div>
  );
}
