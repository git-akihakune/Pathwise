import { and, eq, gt, lte } from "drizzle-orm";
import { type DbOrTx, schema } from "../../db";
import { NotFoundError } from "../../errors";
import { JOBS, type JobDeps } from "../../jobs/queue";
import { createLogger } from "../../logger";
import { type Mailer, mailErrorFields, renderCheckinEmail, renderNudgeEmail } from "../../mail";
import { abandonRun, getActiveRun, startWorkflow } from "../../workflows/instance";
import { getUserSettings } from "../settings";
import { checkinWeekOf, computeDueAt } from "./schedule";
import {
  createScheduledCheckin,
  getCheckin,
  getCheckinForWeek,
  markMissed,
  markNudged,
  markSent,
  setCheckinRun,
} from "./service";
import type { WeekSummary } from "./week";

const log = createLogger("checkins");

export type CheckinDeps = JobDeps & { mailer: Mailer };

export const NUDGE_AFTER_SECONDS = 48 * 3600;
export const MISSED_AFTER_SECONDS = 7 * 86400;

export async function getUserContact(
  db: DbOrTx,
  userId: string,
): Promise<{ email: string; name: string }> {
  const [row] = await db
    .select({ email: schema.user.email, name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  if (!row) throw new NotFoundError("Not found.");
  return row;
}

/** The user id for an email (case-insensitive), or null. */
export async function findUserIdByEmail(db: DbOrTx, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email.trim().toLowerCase()));
  return row?.id ?? null;
}

/** Creates due check-ins and retries overdue scheduled rows for users with an active plan. */
export async function dispatchCheckins(
  deps: CheckinDeps,
  now: Date = new Date(),
): Promise<{ created: number }> {
  const users = await deps.db
    .select({
      userId: schema.plans.userId,
      enabled: schema.userSettings.checkinEnabled,
      day: schema.userSettings.checkinDay,
      time: schema.userSettings.checkinTime,
      timezone: schema.userSettings.timezone,
    })
    .from(schema.plans)
    .leftJoin(schema.userSettings, eq(schema.userSettings.userId, schema.plans.userId))
    .where(eq(schema.plans.status, "active"));
  let created = 0;
  for (const u of users) {
    // A missing settings row means the defaults: enabled, Sunday, 18:00, UTC.
    if (u.enabled === false) continue;
    try {
      const settings = {
        timezone: u.timezone,
        checkinDay: u.day ?? 0,
        checkinTime: u.time ?? "18:00",
      };
      const dueAt = computeDueAt(settings, now);
      const inserted =
        dueAt.getTime() <= now.getTime()
          ? await createScheduledCheckin(deps.db, u.userId, {
              weekOf: checkinWeekOf(dueAt, settings.timezone ?? "UTC"),
              dueAt,
            })
          : null;
      if (inserted) created++;
      // Recovery also runs before this week's due time, including after local Monday.
      const scheduled = await deps.db
        .select()
        .from(schema.checkins)
        .where(
          and(
            eq(schema.checkins.userId, u.userId),
            eq(schema.checkins.status, "scheduled"),
            lte(schema.checkins.dueAt, now),
          ),
        );
      for (const checkin of scheduled) {
        if (checkin.id !== inserted?.id && now.getTime() - checkin.dueAt.getTime() < 5 * 60_000)
          continue;
        if (await hasNewerCheckin(deps.db, u.userId, checkin.weekOf)) {
          await missCheckinAndAbandon(deps.db, u.userId, checkin.id);
          continue;
        }
        await deps.queue.send(
          JOBS.checkinPrepare,
          { userId: u.userId, checkinId: checkin.id },
          { singletonKey: `${JOBS.checkinPrepare}:${checkin.id}` },
        );
      }
    } catch (err) {
      // Content-free; the next 15-minute tick retries the other users regardless.
      log.error({ userId: u.userId, err: mailErrorFields(err).name }, "dispatch failed");
    }
  }
  return { created };
}

async function hasNewerCheckin(db: DbOrTx, userId: string, weekOf: string): Promise<boolean> {
  const [newer] = await db
    .select({ id: schema.checkins.id })
    .from(schema.checkins)
    .where(and(eq(schema.checkins.userId, userId), gt(schema.checkins.weekOf, weekOf)))
    .limit(1);
  return !!newer;
}

async function missCheckinAndAbandon(db: DbOrTx, userId: string, checkinId: string): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await markMissed(tx, userId, checkinId))) return;
    const { workflowRunId } = await getCheckin(tx, userId, checkinId);
    if (workflowRunId) await abandonRun(tx, userId, workflowRunId);
  });
}

async function emailAllowed(deps: CheckinDeps, userId: string): Promise<boolean> {
  return deps.mailer.enabled && (await getUserSettings(deps.db, userId)).emailEnabled;
}

/** Email failures are logged (content-free) and never thrown: a retry must not resend. */
async function trySend(
  deps: CheckinDeps,
  to: string,
  kind: string,
  build: () => Promise<{ subject: string; html: string; text: string }>,
) {
  try {
    await deps.mailer.send({ to, ...(await build()) });
  } catch (err) {
    log.warn({ kind, ...mailErrorFields(err) }, "check-in email failed");
  }
}

export async function prepareCheckin(
  deps: CheckinDeps,
  data: { userId: string; checkinId: string },
  now: Date = new Date(),
): Promise<void> {
  const { userId, checkinId } = data;
  const { db } = deps;
  const checkin = await getCheckin(db, userId, checkinId);
  if (checkin.status !== "scheduled") return;
  // A delayed job must not resurrect a week superseded by a newer check-in.
  if (await hasNewerCheckin(db, userId, checkin.weekOf)) {
    await missCheckinAndAbandon(db, userId, checkinId);
    return;
  }

  // An unfinished check-in from an earlier week gives way to this one (no email).
  const open = await getActiveRun(db, userId, "checkin");
  const openFor = open?.state.checkinId;
  if (open && openFor !== checkinId) {
    await abandonRun(db, userId, open.id);
    if (typeof openFor === "string") await markMissed(db, userId, openFor);
  }

  const run = await startWorkflow(deps, userId, "checkin", { checkinId, weekOf: checkin.weekOf });
  await setCheckinRun(db, userId, checkinId, run.id);
  // Enqueue before claiming so a queue failure leaves preparation retryable.
  await deps.queue.send(
    JOBS.checkinFollowup,
    { userId, checkinId, stage: "nudge" },
    {
      startAfterSeconds: NUDGE_AFTER_SECONDS,
      singletonKey: `${JOBS.checkinFollowup}:nudge:${checkinId}`,
    },
  );
  // Claim before emailing: only the winning transition sends an email.
  if (!(await markSent(db, userId, checkinId, now))) return;
  if (!(await emailAllowed(deps, userId))) return;
  const week = run.state.week as WeekSummary | undefined;
  await trySend(deps, (await getUserContact(db, userId)).email, "prepare", async () =>
    renderCheckinEmail({
      name: (await getUserContact(db, userId)).name,
      weekOf: checkin.weekOf,
      done: (week?.done ?? []).map((a) => a.title),
      remaining: (week?.remaining ?? []).map((a) => a.title),
      url: `${deps.config.appUrl}/checkin`,
    }),
  );
}

export async function followupCheckin(
  deps: CheckinDeps,
  data: { userId: string; checkinId: string; stage: "nudge" | "final" },
  now: Date = new Date(),
): Promise<void> {
  const { userId, checkinId } = data;
  const { db } = deps;
  if (data.stage === "final") {
    await missCheckinAndAbandon(db, userId, checkinId);
    return;
  }
  const checkin = await getCheckin(db, userId, checkinId);
  if (checkin.status !== "sent") return;
  const { dueAt } = checkin;
  // Preserve the sent state if enqueueing the final check fails, allowing a retry.
  await deps.queue.send(
    JOBS.checkinFollowup,
    { userId, checkinId, stage: "final" },
    {
      startAfterSeconds: Math.max(
        0,
        Math.ceil((dueAt.getTime() + MISSED_AFTER_SECONDS * 1000 - now.getTime()) / 1000),
      ),
      singletonKey: `${JOBS.checkinFollowup}:final:${checkinId}`,
    },
  );
  if (!(await markNudged(db, userId, checkinId, now))) return;
  if (!(await emailAllowed(deps, userId))) return;
  const contact = await getUserContact(db, userId);
  await trySend(deps, contact.email, "nudge", () =>
    renderNudgeEmail({ name: contact.name, url: `${deps.config.appUrl}/checkin` }),
  );
}

/** Opens or resumes this week's scheduled check-in (the CLI). */
export async function openCheckinNow(
  deps: CheckinDeps,
  userId: string,
  now: Date = new Date(),
): Promise<{ opened: boolean; weekOf: string }> {
  const tz = (await getUserSettings(deps.db, userId)).timezone ?? "UTC";
  const weekOf = checkinWeekOf(now, tz);
  const checkin =
    (await createScheduledCheckin(deps.db, userId, { weekOf, dueAt: now })) ??
    (await getCheckinForWeek(deps.db, userId, weekOf));
  if (checkin?.status !== "scheduled") return { opened: false, weekOf };
  await prepareCheckin(deps, { userId, checkinId: checkin.id }, now);
  return { opened: true, weekOf };
}
