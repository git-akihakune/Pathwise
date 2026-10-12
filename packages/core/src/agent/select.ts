import type { Screen, SkillId, WorkflowTurn } from "./registry";

const CANONICAL: SkillId[] = ["core", "direction", "planning", "intake", "checkin"];

export const SCREEN_SKILLS: Record<Screen, SkillId[]> = {
  today: [],
  coach: [],
  profile: [],
  stories: [],
  plan: ["planning"],
};

export const WORKFLOW_ONLY: SkillId[] = ["intake", "checkin"];

export function selectSkills(input: {
  classified: SkillId[];
  recent: SkillId[][];
  screen?: Screen;
  workflow?: WorkflowTurn;
}): SkillId[] {
  if (input.workflow) return ["core", ...input.workflow.skills];
  const wanted = new Set<SkillId>([
    "core",
    ...input.classified,
    ...input.recent.slice(-3).flat(),
    ...(input.screen ? SCREEN_SKILLS[input.screen] : []),
  ]);
  return CANONICAL.filter((id) => wanted.has(id) && !WORKFLOW_ONLY.includes(id));
}
