import { tool } from "ai";
import { z } from "zod";
import type { DbOrTx } from "../../db";
import { listMemory, type MemoryCategory } from "../../services/memory";
import { getProfile } from "../../services/profile";
import { listProposals } from "../../services/proposals";
import { registerSkill, type SkillContext } from "../registry";

export const INTAKE_TOPICS = [
  "values",
  "constraints",
  "energizers",
  "drains",
  "aspirations",
  "current_situation",
] as const;
export type IntakeTopic = (typeof INTAKE_TOPICS)[number];

const TOPIC_CATEGORY: Record<Exclude<IntakeTopic, "current_situation">, MemoryCategory> = {
  values: "value",
  constraints: "constraint",
  energizers: "energizer",
  drains: "drain",
  aspirations: "aspiration",
};

/** A topic is covered by an active or pending memory item, or a pending memory proposal. */
export async function computeIntakeCoverage(
  db: DbOrTx,
  userId: string,
): Promise<{ covered: IntakeTopic[]; missing: IntakeTopic[] }> {
  const [items, proposals, profile] = await Promise.all([
    listMemory(db, userId, { status: ["active", "pending"] }),
    listProposals(db, userId, { status: ["pending"] }),
    getProfile(db, userId),
  ]);
  const categories = new Set<string>(items.map((m) => m.category));
  for (const p of proposals) {
    if (p.kind === "memory_add") categories.add((p.payload as { category: string }).category);
  }
  const has = (topic: IntakeTopic) =>
    topic === "current_situation"
      ? categories.has("fact") || profile.experiences.some((e) => e.endDate === null)
      : categories.has(TOPIC_CATEGORY[topic]);
  return {
    covered: INTAKE_TOPICS.filter(has),
    missing: INTAKE_TOPICS.filter((t) => !has(t)),
  };
}

registerSkill({
  id: "intake",
  description: "Get to know a new user during onboarding.",
  workflowOnly: true,
  promptFragment: () =>
    "You are getting to know a new user. Ask one open question at a time, reflect back what you heard, and use proposeMemory for each clear value, constraint, energizer, drain or aspiration. Call getIntakeCoverage before choosing the next topic. Keep it warm and brief; the user can move on at any time.",
  tools: (ctx: SkillContext) => ({
    getIntakeCoverage: tool({
      description: "Which intake topics have been covered so far and which are still missing.",
      inputSchema: z.object({}),
      execute: () => computeIntakeCoverage(ctx.deps.db, ctx.userId),
    }),
  }),
});
