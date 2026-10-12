import { z } from "zod";
import type { PROPOSAL_KINDS, PROPOSAL_STATUSES } from "../../db/schema/proposals";
import { MEMORY_CATEGORIES, type MemoryCategory } from "../memory";
import { type CareerPathInput, careerPathInputSchema } from "../paths";
import {
  type ActionInput,
  actionInputSchema,
  createPlanInputSchema,
  type Milestone,
  type MilestoneInput,
  milestoneInputSchema,
  northStarSchema,
} from "../plan";
import {
  educationInputSchema,
  educationPatchSchema,
  experienceInputSchema,
  experiencePatchSchema,
  skillInputSchema,
  skillPatchSchema,
} from "../profile";
import { type StoryInput, storyInputSchema, storyPatchSchema } from "../stories";

export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface ProposalPayloads {
  profile_update: {
    entity: "experience" | "education" | "skill";
    op: "create" | "update" | "delete";
    id?: string;
    fields?: Record<string, unknown>;
  };
  memory_add: { category: MemoryCategory; content: string; sensitive: boolean };
  memory_update: { id: string; content?: string; category?: MemoryCategory };
  story_add: StoryInput;
  story_update: { id: string; fields: Partial<StoryInput> };
  path_save: CareerPathInput;
  plan_create: z.input<typeof createPlanInputSchema>;
  plan_change: {
    northStar?: string;
    milestones: {
      add: MilestoneInput[];
      update: ({ id: string; status?: Milestone["status"] } & Partial<MilestoneInput>)[];
      remove: string[];
    };
    actions: {
      add: ActionInput[];
      update: ({ id: string } & Partial<ActionInput>)[];
      remove: string[];
    };
  };
  action_status_update: {
    updates: { actionId: string; status: "done" | "skipped" | "todo"; basedOnVersion: number }[];
  };
}
export type ProposalPayload<K extends ProposalKind> = ProposalPayloads[K];

const id = z.string().uuid();
const stripProvenance = (fields: Record<string, unknown>) => {
  const { sourceType: _t, sourceId: _i, ...rest } = fields;
  return rest;
};

const profileSchemas = {
  experience: { create: experienceInputSchema, update: experiencePatchSchema },
  education: { create: educationInputSchema, update: educationPatchSchema },
  skill: { create: skillInputSchema, update: skillPatchSchema },
} as const;

const profileUpdate = z
  .object({
    entity: z.enum(["experience", "education", "skill"]),
    op: z.enum(["create", "update", "delete"]),
    id: id.optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
  })
  .transform((p, ctx) => {
    if (p.op !== "create" && !p.id) {
      ctx.addIssue({ code: "custom", message: "An id is required.", path: ["id"] });
    }
    if (p.op === "delete") return { entity: p.entity, op: p.op, id: p.id };
    if (!p.fields) {
      ctx.addIssue({ code: "custom", message: "Fields are required.", path: ["fields"] });
      return z.NEVER;
    }
    const checked = profileSchemas[p.entity][p.op].safeParse(stripProvenance(p.fields));
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        ctx.addIssue({ code: "custom", message: issue.message, path: ["fields", ...issue.path] });
      }
      return z.NEVER;
    }
    // Provenance is set at apply time, so it is not kept in the stored payload.
    return { entity: p.entity, op: p.op, id: p.id, fields: stripProvenance(checked.data) };
  });

const memoryAdd = z.object({
  category: z.enum(MEMORY_CATEGORIES),
  content: z.string().trim().min(1, "Enter something to remember.").max(1000),
  sensitive: z.boolean(),
});

const memoryUpdate = memoryAdd
  .pick({ category: true, content: true })
  .partial()
  .extend({ id })
  .refine((p) => p.content !== undefined || p.category !== undefined, "Nothing to change.");

const storyUpdate = z.object({
  id,
  fields: storyPatchSchema.refine((f) => Object.keys(f).length > 0, "Nothing to change."),
});

const idList = z.array(id).max(50);
const planChange = z.object({
  northStar: northStarSchema.optional(),
  milestones: z.object({
    add: z.array(milestoneInputSchema).max(12),
    update: z
      .array(
        milestoneInputSchema
          .partial()
          .extend({ id, status: z.enum(["open", "done", "dropped"]).optional() }),
      )
      .max(50),
    remove: idList,
  }),
  actions: z.object({
    add: z.array(actionInputSchema).max(50),
    update: z.array(actionInputSchema.partial().extend({ id })).max(50),
    remove: idList,
  }),
});

const actionStatusUpdate = z.object({
  updates: z
    .array(
      z.object({
        actionId: id,
        status: z.enum(["done", "skipped", "todo"]),
        basedOnVersion: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(50)
    .refine((u) => new Set(u.map((x) => x.actionId)).size === u.length, "Duplicate action."),
});

export const proposalPayloadSchemas = {
  profile_update: profileUpdate,
  memory_add: memoryAdd,
  memory_update: memoryUpdate,
  story_add: storyInputSchema,
  story_update: storyUpdate,
  path_save: careerPathInputSchema,
  plan_create: createPlanInputSchema,
  plan_change: planChange,
  action_status_update: actionStatusUpdate,
} as unknown as { [K in ProposalKind]: z.ZodType<ProposalPayload<K>> };
