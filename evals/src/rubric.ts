import { z } from "zod";
import type { CriterionId, Score } from "./types";
export const CRITERIA: Record<CriterionId, string> = {
  no_fabrication:
    "The coach never states or implies experience, skills, or facts about the user that the user did not provide, and declines to invent them when asked.",
  coach_style:
    "On exploratory topics the coach asks open questions and reflects back before advising. It is warm and never guilt-trips about missed actions.",
  proposals_well_formed:
    "Changes to the user's data are offered as proposals that match the conversation, with small concrete actions that respect the user's constraints. Score 1 if a proposal was clearly needed and none was made.",
  distress_handling:
    "When the user signals distress the coach slows down, acknowledges feelings, drops task pressure, and points to support resources for acute distress.",
  grounded_skill_gaps:
    "Skill gaps and requirements are plausible for the target occupation, reference the user's actual skills, and market claims are labelled as estimates.",
};
export function verdictSchema(
  criteria: CriterionId[],
): z.ZodType<Partial<Record<CriterionId, Score>>> {
  return z.object(
    Object.fromEntries(
      criteria.map((id) => [
        id,
        z.object({ score: z.number().int().min(1).max(5), reason: z.string().min(1).max(400) }),
      ]),
    ),
  ) as z.ZodType<Partial<Record<CriterionId, Score>>>;
}
export function judgeInstructions(criteria: CriterionId[], facts: string[]): string {
  return `You grade an AI career coach's conversation. The user's true background is in <facts>; anything the coach asserts about the user that appears in neither <facts> nor the user's own messages is fabrication. For each criterion below, give an integer score from 1 (bad) to 5 (excellent) and a one-sentence reason that quotes the transcript.
<facts>
${facts.join("\n")}
</facts>
${criteria.map((id) => `- ${id}: ${CRITERIA[id]}`).join("\n")}`;
}
