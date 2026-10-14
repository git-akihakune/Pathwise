import { tool } from "ai";
import { z } from "zod";
import { buildWeekSummary } from "../../services/checkins/week";
import { actionsForWeek } from "../../services/plan";
import { createProposal } from "../../services/proposals";
import { wrapData } from "../context";
import { getSkill, registerSkill, type SkillContext } from "../registry";

const noRun = () => ({ error: "No check-in is open." });

async function activeRun(ctx: SkillContext) {
  // The engine loads the skill registry; defer the reverse edge until a tool/context is used.
  const { getActiveRun } = await import("../../workflows/instance");
  return getActiveRun(ctx.deps.db, ctx.userId, "checkin");
}

function checkinTools(ctx: SkillContext) {
  const active = () => activeRun(ctx);
  const planning = getSkill("planning").tools(ctx).proposePlanChange;
  if (!planning?.execute) throw new Error("Planning proposal tool is not registered.");
  const proposePlanChange = planning.execute;
  return {
    getWeekSummary: tool({
      description: "Get the actions and activity for the open check-in's week.",
      inputSchema: z.object({}),
      execute: async () => {
        const run = await active();
        if (!run) return noRun();
        return buildWeekSummary(ctx.deps.db, ctx.userId, run.state.weekOf as string);
      },
    }),
    proposeActionStatusUpdates: tool({
      description: "Suggest statuses for this week's actions. Use the action ids in the context.",
      inputSchema: z.object({
        updates: z
          .array(
            z.object({ actionId: z.string().uuid(), status: z.enum(["done", "skipped", "todo"]) }),
          )
          .min(1)
          .max(20),
      }),
      execute: async ({ updates }) => {
        const run = await active();
        if (!run) return noRun();
        const actions = await actionsForWeek(ctx.deps.db, ctx.userId, run.state.weekOf as string);
        const versions = new Map(actions.map((a) => [a.id, a.version]));
        if (updates.some((u) => !versions.has(u.actionId))) {
          return { error: "Unknown action id. Use the ids listed in this week's actions." };
        }
        const proposal = await createProposal(ctx.deps.db, ctx.userId, {
          kind: "action_status_update",
          payload: {
            updates: updates.map((u) => ({
              ...u,
              basedOnVersion: versions.get(u.actionId) as number,
            })),
          },
          sessionId: ctx.sessionId,
          messageId: ctx.messageId,
        });
        return { proposalId: proposal.id };
      },
    }),
    proposePlanChange: {
      ...planning,
      execute: async (
        input: Parameters<typeof proposePlanChange>[0],
        options: Parameters<typeof proposePlanChange>[1],
      ) => {
        const run = await active();
        if (!run) return noRun();
        const energy = run.state.energy;
        if (typeof energy === "number" && energy <= 2 && input.actions.add.length > 2) {
          return { error: `Energy is low this week (${energy}/5). Propose at most 2 new actions.` };
        }
        return proposePlanChange(input, options);
      },
    },
  };
}

registerSkill({
  id: "checkin",
  description: "Review the week and propose next week's actions during a check-in.",
  workflowOnly: true,
  promptFragment: () =>
    "You are running the user's weekly check-in. Be brief and warm, ask one thing at a time, and never guilt-trip about unfinished actions. Use the action ids listed in this week's actions.",
  tools: checkinTools,
  contextProviders: [
    {
      id: "checkin.week",
      maxTokens: 600,
      async render(ctx) {
        const run = await activeRun(ctx);
        if (!run) return "";
        const actions = await actionsForWeek(ctx.deps.db, ctx.userId, run.state.weekOf as string);
        const lines = actions.map((a) => `- (id: ${a.id}) ${a.title} [${a.status}]`);
        if (typeof run.state.energy === "number") lines.push(`Energy: ${run.state.energy}/5`);
        return wrapData("checkin.week", lines.join("\n"));
      },
    },
  ],
});
