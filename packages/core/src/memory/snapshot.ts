import { eq } from "drizzle-orm";
import { truncateToTokens, wrapData } from "../agent/context";
import { type DbOrTx, schema } from "../db";
import { withUserLlm } from "../jobs/with-llm";
import { generateTextFor } from "../llm/generate";
import type { LlmDeps } from "../llm/types";
import { createLogger } from "../logger";
import { listMemory, type MemoryCategory, type MemoryItem } from "../services/memory";
import { getProfile, type Profile } from "../services/profile";
import { getUserSettings } from "../services/settings";

const log = createLogger("memory");

const MEMORY_LINES: [MemoryCategory, string][] = [
  ["value", "Values"],
  ["constraint", "Constraints"],
  ["aspiration", "Aspirations"],
  ["energizer", "Energizers"],
  ["drain", "Drains"],
  ["preference", "Preferences"],
];

const month = (d: string) => d.slice(0, 7);

/** Deterministic profile text used until an LLM snapshot exists. */
export function renderProfileFallback(profile: Profile, memories: MemoryItem[]): string {
  const lines: string[] = [];
  if (profile.experiences.length > 0) {
    const items = profile.experiences.map((e) => {
      const range = e.startDate
        ? ` (${month(e.startDate)} – ${e.endDate ? month(e.endDate) : "present"})`
        : "";
      return `${e.title}${e.organization ? ` at ${e.organization}` : ""}${range}`;
    });
    lines.push(`Experience: ${items.join("; ")}`);
  }
  if (profile.education.length > 0) {
    const items = profile.education.map((e) => {
      const what = [e.qualification, e.field].filter(Boolean).join(" in ");
      return what ? `${what}, ${e.institution}` : e.institution;
    });
    lines.push(`Education: ${items.join("; ")}`);
  }
  if (profile.skills.length > 0) {
    lines.push(
      `Skills: ${profile.skills.map((s) => (s.level ? `${s.name} (${s.level})` : s.name)).join(", ")}`,
    );
  }
  for (const [category, label] of MEMORY_LINES) {
    const items = memories.filter((m) => m.status === "active" && m.category === category);
    if (items.length > 0) lines.push(`${label}: ${items.map((m) => m.content).join("; ")}`);
  }
  return lines.length > 0 ? lines.join("\n") : "The user hasn't shared their background yet.";
}

/** The stored LLM snapshot, or the deterministic fallback when none exists yet. */
export async function getSnapshotText(db: DbOrTx, userId: string): Promise<string> {
  const [row] = await db
    .select({ content: schema.userSnapshot.content })
    .from(schema.userSnapshot)
    .where(eq(schema.userSnapshot.userId, userId));
  if (row) return row.content;
  const [profile, memories] = await Promise.all([
    getProfile(db, userId),
    listMemory(db, userId, { status: ["active"] }),
  ]);
  return renderProfileFallback(profile, memories);
}

const SNAPSHOT_INSTRUCTIONS =
  "Write a compact third-person summary of this person for their career coach: background, strengths, values, constraints, and goals. At most 300 words. Use only the data.";

/**
 * Regenerates the user's snapshot with the fast model. Without a usable provider, or when
 * generation fails, the deterministic fallback is stored instead so the maintenance tick does
 * not re-enqueue the refresh forever.
 */
export async function refreshSnapshot(deps: LlmDeps, userId: string): Promise<void> {
  const { db } = deps;
  const { profileVersion } = await getUserSettings(db, userId);
  const [profile, memories] = await Promise.all([
    getProfile(db, userId),
    listMemory(db, userId, { status: ["active"] }),
  ]);
  const fallback = renderProfileFallback(profile, memories);
  let content = fallback;
  try {
    await withUserLlm(deps, userId, async (llm) => {
      const notes = memories
        .filter((m) => m.category === "fact" || m.category === "event")
        .map((m) => `- ${m.content}`)
        .join("\n");
      const text = await generateTextFor(deps, llm, {
        role: "fast",
        purpose: "snapshot",
        instructions: SNAPSHOT_INSTRUCTIONS,
        prompt: `${wrapData("profile", fallback)}${notes ? `\n${wrapData("notes", notes)}` : ""}`,
      });
      if (text.trim()) content = text.trim();
    });
  } catch (e) {
    log.warn({ userId, err: (e as Error).name }, "snapshot generation failed, storing fallback");
  }
  content = truncateToTokens(content, 2000);
  await db
    .insert(schema.userSnapshot)
    .values({ userId, content, profileVersion, generatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.userSnapshot.userId,
      set: { content, profileVersion, generatedAt: new Date(), updatedAt: new Date() },
    });
}
