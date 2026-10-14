import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { type DbOrTx, schema } from "../../db";
import { actionsForWeek } from "../plan";
import { effectiveTimezone, getUserSettings } from "../settings";
import { zonedTimeToUtc } from "./schedule";

interface ActionRef {
  id: string;
  title: string;
}

export interface WeekSummary {
  weekOf: string;
  done: ActionRef[];
  remaining: ActionRef[];
  skipped: ActionRef[];
  sessions: number;
  approvedProposals: number;
  pendingProposals: number;
}

const ymd = (d: Date) => ({
  year: d.getUTCFullYear(),
  month: d.getUTCMonth() + 1,
  day: d.getUTCDate(),
});

/** The user's actions for the week plus what happened in it (the local Monday–Sunday week). */
export async function buildWeekSummary(
  db: DbOrTx,
  userId: string,
  weekOf: string,
): Promise<WeekSummary> {
  const timeZone = effectiveTimezone(await getUserSettings(db, userId));
  const monday = new Date(`${weekOf}T00:00:00Z`);
  const nextMonday = new Date(monday.getTime() + 7 * 86_400_000);
  const start = zonedTimeToUtc(ymd(monday), "00:00", timeZone);
  const end = zonedTimeToUtc(ymd(nextMonday), "00:00", timeZone);

  const actions = await actionsForWeek(db, userId, weekOf);
  const ref = (status: string): ActionRef[] =>
    actions.filter((a) => a.status === status).map((a) => ({ id: a.id, title: a.title }));

  // The check-in's own session (a workflow session) is not a coaching chat.
  const s = schema.sessions;
  const sessions = await db
    .select({ id: s.id })
    .from(s)
    .where(
      and(
        eq(s.userId, userId),
        isNull(s.workflowRunId),
        gte(s.startedAt, start),
        lt(s.startedAt, end),
      ),
    );
  const p = schema.proposals;
  const proposals = await db
    .select({ status: p.status, createdAt: p.createdAt, resolvedAt: p.resolvedAt })
    .from(p)
    .where(eq(p.userId, userId));
  const within = (d: Date | null) => d !== null && d >= start && d < end;

  return {
    weekOf,
    done: ref("done"),
    remaining: ref("todo"),
    skipped: ref("skipped"),
    sessions: sessions.length,
    approvedProposals: proposals.filter((x) => x.status === "approved" && within(x.resolvedAt))
      .length,
    pendingProposals: proposals.filter((x) => x.status === "pending" && within(x.createdAt)).length,
  };
}
