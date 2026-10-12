import { StoryForm } from "../story-form";

export default function NewStoryPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">New story</h1>
      <StoryForm />
    </div>
  );
}
