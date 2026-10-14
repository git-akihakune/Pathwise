export const metadata = { title: "Profile" };

import { listMemory, PROFILE_MEMORY_CATEGORIES } from "@pathwise/core/services/memory";
import { getProfile } from "@pathwise/core/services/profile";
import { connection } from "next/server";
import { OpenFormProvider } from "@/components/entity-form";
import { PageHeader } from "@/components/page-header";
import { PendingMemoryList } from "@/components/pending-memory-list";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";
import { EducationSection } from "./education-section";
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
      <PageHeader
        title="Profile"
        description="The experience, strengths, and values that shape your next chapter. Everything here is editable."
      />
      <PendingMemoryList items={pending} />
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Experiences", profile.experiences.length],
          ["Education", profile.education.length],
          ["Skills", profile.skills.length],
        ].map(([label, count]) => (
          <div
            key={label}
            className="flex items-center justify-between rounded-xl border bg-card px-5 py-4"
          >
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="font-heading text-2xl font-semibold tabular-nums">{count}</span>
          </div>
        ))}
      </div>
      <OpenFormProvider>
        <ExperienceSection items={profile.experiences} />
        <EducationSection items={profile.education} />
        <SkillsSection items={profile.skills} />
        <MemorySection items={memory} />
      </OpenFormProvider>
    </div>
  );
}
