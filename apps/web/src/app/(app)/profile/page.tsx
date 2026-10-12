import { listMemory, PROFILE_MEMORY_CATEGORIES } from "@pathwise/core/services/memory";
import { getProfile } from "@pathwise/core/services/profile";
import { connection } from "next/server";
import { PendingMemoryList } from "@/components/pending-memory-list";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";
import { EducationSection } from "./education-section";
import { OpenFormProvider } from "./entity-form";
import { ExperienceSection } from "./experience-section";
import { MemorySection } from "./memory-section";
import { SkillsSection } from "./skills-section";

export default async function ProfilePage() {
  await connection();
  const { userId } = await requireSession();
  const { db } = getServer();
  const categories = PROFILE_MEMORY_CATEGORIES;
  const [profile, memory, pending] = await Promise.all([
    getProfile(db, userId),
    listMemory(db, userId, { categories }),
    listMemory(db, userId, { status: ["pending"], categories }),
  ]);
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-muted-foreground">What I know about you. Everything here is editable.</p>
      </header>
      <PendingMemoryList items={pending} />
      <OpenFormProvider>
        <ExperienceSection items={profile.experiences} />
        <EducationSection items={profile.education} />
        <SkillsSection items={profile.skills} />
        <MemorySection items={memory} />
      </OpenFormProvider>
    </div>
  );
}
