import { tool } from "ai";
import { z } from "zod";
import { NotFoundError } from "../../errors";
import { StructuredOutputError } from "../../llm";
import { createProposal } from "../../services/proposals";
import { getOccupation, searchOccupations } from "../../taxonomy";
import { registerSkill, type SkillContext } from "../registry";
import { clip, generateCareerPaths } from "./career-paths";

// Plain tool schemas (R5); createProposal validates the real path payload.
const searchInput = z.object({
  query: z.string().min(2).max(100),
  source: z.enum(["onet", "esco"]).optional(),
});
const occupationInput = z.object({ idOrCode: z.string() });
const generateInput = z.object({ focus: z.string().max(300).optional() });
const pathInput = z.object({
  title: z.string().min(1).max(200),
  occupationCodes: z.array(z.string()).max(10),
  rationale: z.string().max(4000),
  route: z
    .array(
      z.object({
        title: z.string(),
        kind: z.enum(["role", "learning", "project", "network", "other"]),
        detail: z.string(),
        isBridgeRole: z.boolean(),
      }),
    )
    .max(12),
  skillGaps: z
    .array(
      z.object({
        skill: z.string(),
        taxonomySkillId: z.string().nullable(),
        importance: z.number(),
        note: z.string(),
      }),
    )
    .max(30),
  feasibility: z.object({
    timeMonths: z.object({ min: z.number(), max: z.number() }),
    cost: z.string(),
    risks: z.array(z.string()),
    mustBeTrue: z.array(z.string()),
  }),
});

function directionTools(ctx: SkillContext) {
  return {
    searchOccupations: tool({
      description: "Search O*NET and ESCO occupations by keyword.",
      inputSchema: searchInput,
      execute: async ({ query, source }) => {
        const results = await searchOccupations(ctx.deps.db, query, { limit: 8, source });
        return { results: results.map((o) => ({ ...o, description: clip(o.description, 300) })) };
      },
    }),
    getOccupation: tool({
      description: "Look up one occupation by id or code: tasks, skills, and related occupations.",
      inputSchema: occupationInput,
      execute: async ({ idOrCode }) => {
        const o = await getOccupation(ctx.deps.db, idOrCode);
        if (!o) throw new NotFoundError(`No occupation matches “${idOrCode}”.`);
        return {
          id: o.id,
          source: o.source,
          code: o.code,
          title: o.title,
          description: o.description,
          altTitles: o.altTitles.slice(0, 5),
          tasks: o.tasks.slice(0, 10),
          skills: o.skills.slice(0, 15),
          related: o.related
            .slice(0, 8)
            .map((r) => ({ ...r, description: clip(r.description, 300) })),
        };
      },
    }),
    generateCareerPaths: tool({
      description:
        "Draft 2-4 career paths grounded in occupations and the user's profile. Optionally focus on a theme.",
      inputSchema: generateInput,
      execute: async ({ focus }) => {
        try {
          return await generateCareerPaths(ctx.deps, ctx.llm, ctx.userId, focus);
        } catch (e) {
          if (!(e instanceof StructuredOutputError)) throw e;
          return {
            paths: [],
            note: "I couldn't ground enough paths in real occupations. Try a narrower focus, or tell me more about what you're looking for.",
          };
        }
      },
    }),
    proposeSavePath: tool({
      description: "Suggest saving a career path the user wants to keep. The user approves it.",
      inputSchema: pathInput,
      execute: async (input) => {
        const unknown: string[] = [];
        for (const code of input.occupationCodes) {
          if (!(await getOccupation(ctx.deps.db, code))) unknown.push(code);
        }
        if (unknown.length > 0) {
          throw new NotFoundError(`Unknown occupation codes: ${unknown.join(", ")}.`);
        }
        const p = await createProposal(ctx.deps.db, ctx.userId, {
          kind: "path_save",
          payload: input,
          sessionId: ctx.sessionId,
          messageId: ctx.messageId,
        });
        return { proposalId: p.id };
      },
    }),
  };
}

registerSkill({
  id: "direction",
  description: "Explore career directions, look up occupations, and draft and save career paths.",
  promptFragment: () =>
    "The user is exploring direction. Ask before advising, and reflect back what you hear. Use searchOccupations and getOccupation to ground options in O*NET and ESCO; treat them as reference points, not verdicts, since they are US- and EU-centric. When the user is ready for options, call generateCareerPaths and walk through the 2–4 paths. Save a path only through proposeSavePath, when the user wants to keep it.",
  tools: directionTools,
});
