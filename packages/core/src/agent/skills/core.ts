import { tool } from "ai";
import { z } from "zod";
import { hybridSearch } from "../../memory/retrieval";
import { MEMORY_CATEGORIES } from "../../services/memory";
import { createProposal, type ProposalKind, type ProposalPayload } from "../../services/proposals";
import { registerSkill, type SkillContext } from "../registry";

// Plain tool schemas (R5): the engine's payload schemas carry transforms and defaults, which
// the JSON-schema conversion cannot express. createProposal validates the real payload.
const searchInput = z.object({ query: z.string().min(2).max(200) });
const memoryInput = z.object({
  category: z.enum(MEMORY_CATEGORIES),
  content: z.string().min(3).max(500),
  sensitive: z.boolean(),
});
const profileInput = z.object({
  entity: z.enum(["experience", "education", "skill"]),
  op: z.enum(["create", "update", "delete"]),
  id: z.string().uuid().optional().describe("Required for update and delete."),
  fields: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Required for create and update. Experience: title, organization, startDate, endDate, description, highlights. Education: institution, qualification, field, startDate, endDate. Skill: name, level (basic|working|strong|expert), evidence. Dates are "YYYY", "YYYY-MM" or "YYYY-MM-DD". Unknown field names are rejected.',
    ),
});
const storyInput = z.object({
  title: z.string().min(1).max(200),
  situation: z.string().max(4000).optional(),
  task: z.string().max(4000).optional(),
  action: z.string().max(4000).optional(),
  result: z.string().max(4000).optional(),
  metrics: z.string().max(500).nullable().optional(),
  skills: z.array(z.string().max(100)).max(20).optional(),
});

function coreTools(ctx: SkillContext) {
  const propose = async <K extends ProposalKind>(kind: K, payload: unknown) => {
    const p = await createProposal(ctx.deps.db, ctx.userId, {
      kind,
      payload: payload as ProposalPayload<K>,
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
    });
    return { proposalId: p.id };
  };
  return {
    searchMemory: tool({
      description: "Search what you know about the user (memories, stories, earlier sessions).",
      inputSchema: searchInput,
      execute: async ({ query }) => {
        const items = await hybridSearch(ctx.deps, ctx.llm, ctx.userId, query, { limit: 8 });
        return {
          results: items.map((i) => ({
            kind: i.kind,
            text: i.text,
            category: i.category,
            date: i.createdAt.toISOString().slice(0, 10),
          })),
        };
      },
    }),
    proposeMemory: tool({
      description: "Suggest remembering a lasting fact about the user. The user approves it.",
      inputSchema: memoryInput,
      execute: (input) => propose("memory_add", input),
    }),
    proposeProfileUpdate: tool({
      description:
        "Suggest adding, changing, or removing an experience, education entry, or skill.",
      inputSchema: profileInput,
      execute: (input) => propose("profile_update", input),
    }),
    proposeStory: tool({
      description: "Suggest saving an achievement as a story (situation, task, action, result).",
      inputSchema: storyInput,
      execute: (input) => propose("story_add", input),
    }),
  };
}

registerSkill({
  id: "core",
  description: "Remember facts, look up past context, and propose profile and story updates.",
  promptFragment: () =>
    "Use searchMemory when earlier context would help and isn't shown above. When the user shares a lasting fact about themselves, propose it with proposeMemory. Mark health, family, finances, immigration or visa status, religion, sexual orientation, ethnicity, and political views as sensitive. Use proposeProfileUpdate for experience, education, and skills, and proposeStory when they describe an achievement worth keeping. Propose only what the user actually said.",
  tools: coreTools,
});
