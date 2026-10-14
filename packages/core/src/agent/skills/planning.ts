import { tool } from "ai";
import { z } from "zod";
import { NotFoundError, ValidationError } from "../../errors";
import { type ActivePlan, getActivePlan, isDate, mondayOf, weekStartOf } from "../../services/plan";
import { createProposal, type ProposalPayload } from "../../services/proposals";
import { registerSkill, type SkillContext } from "../registry";

// Plain tool schemas (R5); createProposal validates the real payload.
const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");
const id = z.string().uuid();
const milestone = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  targetDate: ymd.optional(),
});
const planInput = z.object({
  careerPathId: id.optional(),
  northStar: z.string().min(5).max(200),
  milestones: z.array(milestone).min(1).max(6),
  actions: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        notes: z.string().max(4000).optional(),
        weekOf: ymd.optional().describe("A Monday. Defaults to this week."),
        milestoneIndex: z.number().int().min(0).optional(),
      }),
    )
    .min(1)
    .max(5),
});
const changeInput = z.object({
  northStar: z.string().min(5).max(200).optional(),
  milestones: z.object({
    add: z.array(milestone).max(6),
    update: z
      .array(
        milestone.partial().extend({ id, status: z.enum(["open", "done", "dropped"]).optional() }),
      )
      .max(20),
    remove: z.array(id).max(20),
  }),
  actions: z.object({
    add: z
      .array(
        z.object({
          title: z.string().min(1).max(200),
          notes: z.string().max(4000).optional(),
          weekOf: ymd.optional().describe("A Monday. Defaults to this week."),
          milestoneId: id.optional().describe("An existing milestone of the active plan."),
        }),
      )
      .max(5),
    update: z
      .array(
        z.object({
          id,
          title: z.string().min(1).max(200).optional(),
          notes: z.string().max(4000).optional(),
          weekOf: ymd.optional(),
          milestoneId: id.optional(),
        }),
      )
      .max(20),
    remove: z.array(id).max(20),
  }),
});

function assertMonday(weekOf: string): void {
  if (!isDate(weekOf) || weekStartOf(weekOf) !== weekOf) {
    throw new ValidationError("weekOf must be a Monday (YYYY-MM-DD).");
  }
}

function planningTools(ctx: SkillContext) {
  const thisMonday = () => mondayOf(new Date(), ctx.timezone);
  const monday = (weekOf: string | undefined) => {
    if (weekOf === undefined) return thisMonday();
    assertMonday(weekOf);
    return weekOf;
  };
  const propose = async <K extends "plan_create" | "plan_change">(
    kind: K,
    payload: ProposalPayload<K>,
  ) => {
    const p = await createProposal(ctx.deps.db, ctx.userId, {
      kind,
      payload,
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
    });
    return { proposalId: p.id };
  };
  const requirePlan = async (): Promise<ActivePlan> => {
    const plan = await getActivePlan(ctx.deps.db, ctx.userId);
    if (!plan)
      throw new NotFoundError("There is no active plan yet. Use proposePlan to create one.");
    return plan;
  };

  return {
    getPlan: tool({
      description:
        "Get the user's active plan: north star, milestones, and recent and upcoming weekly actions.",
      inputSchema: z.object({}),
      execute: async () => {
        const plan = await getActivePlan(ctx.deps.db, ctx.userId);
        if (!plan) return { plan: null };
        const lastMonday = weekStartOf(
          new Date(Date.parse(`${thisMonday()}T00:00:00Z`) - 7 * 86_400_000)
            .toISOString()
            .slice(0, 10),
        );
        return {
          plan: {
            northStar: plan.northStar,
            version: plan.version,
            milestones: plan.milestones.map((m) => ({
              id: m.id,
              title: m.title,
              targetDate: m.targetDate,
              status: m.status,
            })),
            actions: plan.actions
              .filter((a) => a.weekOf >= lastMonday)
              .map((a) => ({
                id: a.id,
                title: a.title,
                weekOf: a.weekOf,
                status: a.status,
                milestoneId: a.milestoneId,
              })),
          },
        };
      },
    }),
    proposePlan: tool({
      description:
        "Suggest a new plan: a north star, 1-6 milestones, and 1-5 small actions for the first week. Replaces the active plan when approved.",
      inputSchema: planInput,
      execute: (input) =>
        propose("plan_create", {
          ...input,
          actions: input.actions.map((a) => ({ ...a, weekOf: monday(a.weekOf) })),
        }),
    }),
    proposePlanChange: tool({
      description:
        "Suggest edits to the active plan: change the north star, add, update, or remove milestones and actions. Use ids from getPlan.",
      inputSchema: changeInput,
      execute: async (input) => {
        const plan = await requirePlan();
        const known = new Set([...plan.milestones, ...plan.actions].map((x) => x.id));
        const referenced = [
          ...input.milestones.update.map((m) => m.id),
          ...input.milestones.remove,
          ...input.actions.update.map((a) => a.id),
          ...input.actions.remove,
        ];
        const milestoneRefs = [...input.actions.add, ...input.actions.update]
          .map((a) => a.milestoneId)
          .filter((m): m is string => m !== undefined);
        const unknown = [...new Set([...referenced, ...milestoneRefs])].filter(
          (i) => !known.has(i),
        );
        if (unknown.length > 0) {
          throw new NotFoundError(`Unknown milestone or action ids: ${unknown.join(", ")}`);
        }
        for (const a of input.actions.update) if (a.weekOf !== undefined) assertMonday(a.weekOf);
        return propose("plan_change", {
          ...input,
          actions: {
            ...input.actions,
            add: input.actions.add.map((a) => ({ ...a, weekOf: monday(a.weekOf) })),
          },
        });
      },
    }),
  };
}

registerSkill({
  id: "planning",
  description: "Draft a plan from a chosen path, view it, and propose changes to it.",
  promptFragment: () =>
    "The user is planning. Be concrete and practical. Use getPlan to see the current plan. proposePlan replaces the active plan when approved, so adjust an existing plan with proposePlanChange. Milestones span 3–6 months; weekly actions must be small enough to finish in a week. Use proposePlan to create a plan from a chosen path, and proposePlanChange for edits. Propose at most 5 actions for any week.",
  tools: planningTools,
});
