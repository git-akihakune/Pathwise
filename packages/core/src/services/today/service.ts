import { and, desc, eq, isNotNull } from "drizzle-orm";
import { type DbOrTx, schema } from "../../db";
import { getOnboardingState, latestRun, type OnboardingState } from "../../workflows";
import { latestCheckin, nextDueAt } from "../checkins";
import { listMemory, type MemoryItem } from "../memory";
import { type Action, actionsForWeek, mondayOf } from "../plan";
import { listProposals, type Proposal } from "../proposals";
import { effectiveTimezone, getUserSettings } from "../settings";

export type CheckinCardState = "off" | "upcoming" | "open" | "completed" | "missed";

export interface TodayView {
  weekOf: string;
  actions: Action[];
  checkin: { state: CheckinCardState; nextDueAt: Date | null; nudged: boolean };
  coachNote: string | null;
  onboarding: OnboardingState;
  pendingProposals: Proposal[];
  pendingMemories: MemoryItem[];
}

async function coachNote(db: DbOrTx, userId: string): Promise<string | null> {
  const s = schema.sessions;
  const [session] = await db
    .select({ summary: s.summary })
    .from(s)
    .where(and(eq(s.userId, userId), isNotNull(s.summary)))
    .orderBy(desc(s.lastMessageAt), desc(s.id))
    .limit(1);
  if (session) return session.summary;
  const run = await latestRun(db, userId, "onboarding");
  const heard = run?.state.heard;
  if (run?.status !== "completed" || typeof heard !== "string") return null;
  if (heard.length <= 280) return heard;
  const cut = heard.slice(0, 280);
  return (/\s/.test(heard[280] ?? "") ? cut : cut.replace(/\s+\S*$/, "")).trimEnd();
}

export async function getToday(db: DbOrTx, userId: string, now = new Date()): Promise<TodayView> {
  const settings = await getUserSettings(db, userId);
  const weekOf = mondayOf(now, effectiveTimezone(settings));
  const checkin = await latestCheckin(db, userId);
  let state: CheckinCardState;
  if (checkin && ["scheduled", "sent", "nudged"].includes(checkin.status)) state = "open";
  else if (
    checkin?.status === "completed" &&
    now.getTime() < checkin.dueAt.getTime() + 7 * 24 * 60 * 60 * 1000
  )
    state = "completed";
  else if (checkin?.status === "missed") state = "missed";
  else state = settings.checkinEnabled ? "upcoming" : "off";

  const [actions, note, onboarding, pendingProposals, pendingMemories] = await Promise.all([
    actionsForWeek(db, userId, weekOf),
    coachNote(db, userId),
    getOnboardingState(db, userId),
    listProposals(db, userId, { status: ["pending"] }),
    listMemory(db, userId, { status: ["pending"] }),
  ]);
  return {
    weekOf,
    actions,
    checkin: {
      state,
      nextDueAt: state === "off" ? null : nextDueAt(settings, now),
      nudged: checkin?.status === "nudged",
    },
    coachNote: note,
    onboarding,
    pendingProposals,
    pendingMemories,
  };
}
