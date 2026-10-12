import { z } from "zod";
import { generateStructured, type Llm, type LlmDeps, StructuredOutputError } from "../../llm";
import { renderProfileFallback } from "../../memory/snapshot";
import { listMemory } from "../../services/memory";
import { type CareerPathInput, careerPathInputSchema } from "../../services/paths";
import { getProfile } from "../../services/profile";
import {
  type OccupationSummary,
  type SkillGap,
  searchOccupations,
  skillGapsFor,
} from "../../taxonomy";
import { wrapData } from "../context";

const NO_MATCH_NOTE =
  "I couldn't find matching occupations yet. Tell me more about your experience and interests.";

const INSTRUCTIONS =
  "Propose 2–4 realistic career paths for this person. Use only occupations from the candidates; put their codes in occupationCodes. Take skillGaps from the listed gaps of those occupations and add a short note to each. Where a direct move is unrealistic, include bridge roles in the route with isBridgeRole true. Feasibility: time in months as a range; label cost and any market claims as estimates. mustBeTrue lists what would have to be true for the path to work. Never invent facts about the person.";

// Plain, transform-free and all-required (R5): the model's reply is parsed against this, then
// each path is validated with careerPathInputSchema.
const generatedSchema = z.object({
  paths: z
    .array(
      z.object({
        title: z.string(),
        occupationCodes: z.array(z.string()),
        rationale: z.string(),
        route: z.array(
          z.object({
            title: z.string(),
            kind: z.enum(["role", "learning", "project", "network", "other"]),
            detail: z.string(),
            isBridgeRole: z.boolean(),
          }),
        ),
        skillGaps: z.array(
          z.object({
            skill: z.string(),
            taxonomySkillId: z.string().nullable(),
            importance: z.number(),
            note: z.string(),
          }),
        ),
        feasibility: z.object({
          timeMonths: z.object({ min: z.number(), max: z.number() }),
          cost: z.string(),
          risks: z.array(z.string()),
          mustBeTrue: z.array(z.string()),
        }),
      }),
    )
    .min(2)
    .max(4),
});

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function generateCareerPaths(
  deps: LlmDeps,
  llm: Llm,
  userId: string,
  focus?: string,
): Promise<{ paths: CareerPathInput[]; note?: string }> {
  const { db } = deps;
  const [profile, memories] = await Promise.all([getProfile(db, userId), listMemory(db, userId)]);

  const queries = [
    focus?.trim(),
    ...profile.experiences.slice(0, 3).map((e) => e.title),
    ...memories
      .filter((m) => m.category === "aspiration" || m.category === "energizer")
      .slice(0, 3)
      .map((m) => m.content),
  ].filter((q): q is string => !!q);

  const candidates = new Map<string, OccupationSummary>();
  for (const q of queries) {
    for (const o of await searchOccupations(db, q, { limit: 5 })) {
      if (!candidates.has(o.id)) candidates.set(o.id, o);
    }
  }
  const list = [...candidates.values()].slice(0, 12);
  if (list.length === 0) return { paths: [], note: NO_MATCH_NOTE };

  const gaps = new Map<string, SkillGap[]>();
  for (const o of list.slice(0, 6)) gaps.set(o.code, await skillGapsFor(db, userId, o.id, 8));

  const block = (o: OccupationSummary) => {
    const g = (gaps.get(o.code) ?? []).map((x) => `${x.skill} (${x.importance.toFixed(2)})`);
    return `code: ${o.code} | ${o.title} (${o.source})\n${clip(o.description, 300)}${g.length > 0 ? `\ngaps: ${g.join(", ")}` : ""}`;
  };
  // TODO(Task 10): switch to getSnapshotText once snapshots exist (R15).
  const prompt = `${wrapData("profile", renderProfileFallback(profile, memories))}\n${wrapData("candidates", list.map(block).join("\n\n"))}`;

  const out = await generateStructured(deps, llm, {
    role: "main",
    purpose: "paths.generate",
    schema: generatedSchema,
    instructions: INSTRUCTIONS,
    prompt,
  });

  const codes = new Set(list.map((o) => o.code));
  const paths: CareerPathInput[] = [];
  for (const p of out.paths) {
    const occupationCodes = p.occupationCodes.filter((c) => codes.has(c));
    if (occupationCodes.length === 0) continue;
    const known = new Map<string, SkillGap>();
    for (const c of occupationCodes) {
      for (const g of gaps.get(c) ?? []) {
        if (!known.has(g.skill.toLowerCase())) known.set(g.skill.toLowerCase(), g);
      }
    }
    const skillGaps = p.skillGaps.flatMap((g) => {
      const d = known.get(g.skill.trim().toLowerCase());
      return d
        ? [
            {
              skill: d.skill,
              taxonomySkillId: d.taxonomySkillId,
              importance: d.importance,
              note: g.note,
            },
          ]
        : [];
    });
    const parsed = careerPathInputSchema.safeParse({ ...p, occupationCodes, skillGaps });
    if (parsed.success) paths.push(parsed.data);
  }
  if (paths.length < 2) {
    throw new StructuredOutputError("paths must reference the candidate occupations", [
      `${paths.length} of ${out.paths.length} paths were grounded in the candidates`,
    ]);
  }
  return { paths };
}
