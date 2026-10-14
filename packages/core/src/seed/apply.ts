import { addMinutes, addWeeks, format, subDays } from "date-fns";
import type { DbOrTx } from "../db";
import { addMemory } from "../services/memory";
import { savePath, setPathStatus } from "../services/paths";
import { createPlan, mondayOf, setActionStatus } from "../services/plan";
import { createEducation, createExperience, createSkill } from "../services/profile";
import { createProposal } from "../services/proposals";
import { appendMessage, getOrStartSession } from "../services/sessions";
import { updateUserSettings } from "../services/settings";
import { createStory } from "../services/stories";
import { recordCompletedOnboarding } from "../workflows";
import type { PersonaData } from "./types";

export async function applyPersona(
  db: DbOrTx,
  userId: string,
  p: PersonaData,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await updateUserSettings(tx, userId, { timezone: p.timezone, bluntness: p.bluntness });
    for (const e of p.experiences) await createExperience(tx, userId, { ...e, sourceType: "cv" });
    for (const e of p.education) await createEducation(tx, userId, { ...e, sourceType: "cv" });
    for (const s of p.skills) await createSkill(tx, userId, { ...s, sourceType: "cv" });
    for (const m of p.memory)
      await addMemory(tx, userId, {
        ...m,
        sourceType: "message",
        sourceId: null,
        confidence: m.status === "pending" ? 0.6 : 1,
      });
    for (const s of p.stories) await createStory(tx, userId, { ...s, sourceType: "manual" });
    const pathIds = new Map<string, string>();
    for (const pth of p.paths) {
      const path = await savePath(tx, userId, pth);
      await setPathStatus(tx, userId, path.id, pth.status);
      pathIds.set(pth.title, path.id);
    }
    for (const s of [...(p.sessions ?? [])].sort((a, b) => b.daysAgo - a.daysAgo)) {
      const startedAt = subDays(now, s.daysAgo);
      const session = await getOrStartSession(tx, userId, { topic: s.topic, now: startedAt });
      for (const [i, m] of s.messages.entries())
        await appendMessage(tx, userId, session.id, {
          role: m.role,
          parts: [{ type: "text", text: m.text }],
          status: "complete",
          createdAt: addMinutes(startedAt, i),
        });
    }
    for (const story of p.pendingStoryProposals ?? [])
      await createProposal(tx, userId, { kind: "story_add", payload: story });
    await recordCompletedOnboarding(tx, userId);
    if (!p.plan) return;
    const careerPathId = pathIds.get(p.plan.pathTitle);
    if (!careerPathId) throw new Error("Persona plan path not found.");
    const plan = await createPlan(tx, userId, {
      northStar: p.plan.northStar,
      careerPathId,
      milestones: p.plan.milestones.map(({ targetInWeeks, ...m }) => ({
        ...m,
        targetDate: format(addWeeks(now, targetInWeeks), "yyyy-MM-dd"),
      })),
      actions: p.plan.actions.map(({ status: _s, weekOffset, ...a }) => ({
        ...a,
        weekOf: mondayOf(addWeeks(now, weekOffset), p.timezone),
      })),
    });
    // createPlan returns actions in week order; match by title and week rather than input position.
    for (const a of p.plan.actions) {
      if (a.status === "todo") continue;
      const action = plan.actions.find(
        (row) =>
          row.title === a.title && row.weekOf === mondayOf(addWeeks(now, a.weekOffset), p.timezone),
      );
      if (!action) throw new Error("Persona action not found.");
      await setActionStatus(tx, userId, action.id, a.status);
    }
  });
}
