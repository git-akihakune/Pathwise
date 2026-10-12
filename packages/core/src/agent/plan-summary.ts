import type { ActivePlan } from "../services/plan";

export function renderPlanSummary(plan: ActivePlan | null, weekOf: string): string {
  if (!plan) return "No active plan yet.";
  const lines = [`North star: ${plan.northStar}`];
  const current = plan.milestones
    .filter((m) => m.status === "open")
    .sort((a, b) => a.position - b.position)[0];
  if (current) {
    lines.push(
      `Current milestone: ${current.title}${current.targetDate ? ` (target ${current.targetDate})` : ""}`,
    );
  }
  const actions = plan.actions.filter((a) => a.weekOf === weekOf);
  if (actions.length > 0) {
    lines.push("This week's actions:", ...actions.map((a) => `- [${a.status}] ${a.title}`));
  }
  return lines.join("\n");
}
