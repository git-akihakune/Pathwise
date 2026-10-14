import type { ToolSet } from "ai";
import type { Llm, LlmDeps } from "../llm/types";

export type SkillId = "core" | "direction" | "planning" | "intake" | "checkin";
export type Screen = "today" | "coach" | "profile" | "stories" | "plan";

export interface SkillContext {
  deps: LlmDeps;
  llm: Llm;
  userId: string;
  sessionId: string;
  messageId: string;
  timezone: string;
}

export interface ContextProvider {
  id: string;
  maxTokens: number;
  render(ctx: SkillContext): Promise<string>;
}

export interface Skill {
  id: SkillId;
  description: string;
  workflowOnly?: boolean;
  promptFragment(ctx: SkillContext): string;
  tools(ctx: SkillContext): ToolSet;
  contextProviders?: ContextProvider[];
}

export interface WorkflowTurn {
  runId: string;
  stepId: string;
  skills: SkillId[];
  goal: string;
}

const skills = new Map<SkillId, Skill>();

/** Registering an id again replaces the earlier skill. */
export function registerSkill(skill: Skill): void {
  skills.set(skill.id, skill);
}

export function getSkill(id: SkillId): Skill {
  const skill = skills.get(id);
  if (!skill) throw new Error(`Unknown skill: ${id}`);
  return skill;
}

export function listSkills(): Skill[] {
  return [...skills.values()];
}

/** Tools in selected order; on a name clash the later skill's tool wins. */
export function mergeSkillTools(selected: Skill[], ctx: SkillContext): ToolSet {
  return Object.assign({}, ...selected.map((s) => s.tools(ctx)));
}
