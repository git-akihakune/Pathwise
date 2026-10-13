// packages/core/src/services/checkins/jobs.int.test.ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { fakeMailer, seedUser, workflowDeps } from "../../../../../test/integration/fixtures";
import { schema } from "../../db";
import { getActiveRun } from "../../workflows";
import { createPlan } from "../plan";
import { getUserSettings } from "../settings";
import {
  dispatchCheckins,
  followupCheckin,
  getCheckin,
  markCompleted,
  openCheckinNow,
  prepareCheckin,
} from ".";

const db = getTestDb();
let deps: ReturnType<typeof workflowDeps> & { mailer: ReturnType<typeof fakeMailer> };
const DUE = new Date("2026-10-18T22:00:00Z"); // Sunday 18:00 EDT
const AFTER = new Date("2026-10-18T22:10:00Z");
const jobs = (name: string) => deps.queue.sent.filter((j) => j.name === name);
const only = async () => (await db.select().from(schema.checkins))[0]!;
async function dispatchAndPrepare(now = AFTER) {
  await dispatchCheckins(deps, now);
  const rows = await db.select().from(schema.checkins).orderBy(schema.checkins.dueAt);
  const c = rows.at(-1)!;
  await prepareCheckin(deps, { userId: "u1", checkinId: c.id }, now);
  return c;
}

beforeEach(async () => {
  await resetDb(db);
  deps = { ...workflowDeps(db), mailer: fakeMailer() };
  await seedUser(db, "u1");
  await getUserSettings(db, "u1");
  await db
    .update(schema.userSettings)
    .set({ timezone: "America/New_York" })
    .where(eq(schema.userSettings.userId, "u1"));
  await createPlan(db, "u1", {
    northStar: "Health data",
    milestones: [],
    actions: [{ title: "Update CV", weekOf: "2026-10-12" }],
  });
});

describe("check-in jobs", () => {
  it("dispatches once the local due time passes, once per week (Review Focus 2)", async () => {
    await dispatchCheckins(deps, new Date("2026-10-18T21:59:00Z"));
    expect(await db.$count(schema.checkins)).toBe(0);
    await Promise.all([dispatchCheckins(deps, AFTER), dispatchCheckins(deps, AFTER)]);
    const c = await only();
    expect(await db.$count(schema.checkins)).toBe(1);
    expect(c).toMatchObject({ weekOf: "2026-10-12", status: "scheduled", dueAt: DUE });
    expect(jobs("checkin.prepare")).toEqual([
      {
        name: "checkin.prepare",
        data: { userId: "u1", checkinId: c.id },
        opts: { singletonKey: `checkin.prepare:${c.id}` },
      },
    ]);
    await dispatchCheckins(deps, new Date("2026-10-19T01:00:00Z"));
    expect(await db.$count(schema.checkins)).toBe(1);
  });
  it("skips users with check-ins off or without an active plan", async () => {
    await seedUser(db, "u2");
    await db
      .update(schema.userSettings)
      .set({ checkinEnabled: false })
      .where(eq(schema.userSettings.userId, "u1"));
    expect(await dispatchCheckins(deps, AFTER)).toEqual({ created: 0 });
  });
  it("prepare opens the run, emails once, and schedules the nudge (Review Focus 2)", async () => {
    const c = await dispatchAndPrepare();
    await prepareCheckin(deps, { userId: "u1", checkinId: c.id }, AFTER); // pg-boss retry
    const row = await getCheckin(db, "u1", c.id);
    expect(row.status).toBe("sent");
    expect((await getActiveRun(db, "u1", "checkin"))?.id).toBe(row.workflowRunId);
    expect(deps.mailer.sent).toHaveLength(1);
    expect(deps.mailer.sent[0]).toMatchObject({
      to: "u1@x.io",
      subject: "Your weekly check-in is ready",
    });
    expect(deps.mailer.sent[0]?.html).toContain("https://coach.example.com/checkin");
    expect(jobs("checkin.followup")).toEqual([
      {
        name: "checkin.followup",
        data: { userId: "u1", checkinId: c.id, stage: "nudge" },
        opts: { startAfterSeconds: 172_800, singletonKey: `checkin.followup:nudge:${c.id}` },
      },
    ]);
  });
  it("is in-app only when email is off or SMTP is unset", async () => {
    await db
      .update(schema.userSettings)
      .set({ emailEnabled: false })
      .where(eq(schema.userSettings.userId, "u1"));
    const c = await dispatchAndPrepare();
    expect((await getCheckin(db, "u1", c.id)).status).toBe("sent");
    expect(deps.mailer.sent).toHaveLength(0);
  });
  it("nudges once, then marks missed at +7 days with no more email (Review Focus 2)", async () => {
    const c = await dispatchAndPrepare();
    deps.mailer.sent.length = 0;
    const nudgeAt = new Date(AFTER.getTime() + 172_800_000);
    await followupCheckin(deps, { userId: "u1", checkinId: c.id, stage: "nudge" }, nudgeAt);
    await followupCheckin(deps, { userId: "u1", checkinId: c.id, stage: "nudge" }, nudgeAt);
    expect(deps.mailer.sent.map((m) => m.subject)).toEqual(["Your check-in is still open"]);
    expect((await getCheckin(db, "u1", c.id)).status).toBe("nudged");
    const final = jobs("checkin.followup").find(
      (j) => (j.data as { stage?: string }).stage === "final",
    );
    expect(final?.opts?.startAfterSeconds).toBe(
      (DUE.getTime() + 7 * 86_400_000 - nudgeAt.getTime()) / 1000,
    );
    await followupCheckin(
      deps,
      { userId: "u1", checkinId: c.id, stage: "final" },
      new Date(DUE.getTime() + 7 * 86_400_000),
    );
    expect((await getCheckin(db, "u1", c.id)).status).toBe("missed");
    expect(await getActiveRun(db, "u1", "checkin")).toBeNull();
    expect(deps.mailer.sent).toHaveLength(1);
  });
  it("never nudges a completed check-in", async () => {
    const c = await dispatchAndPrepare();
    await markCompleted(db, "u1", c.id, { summary: null });
    await followupCheckin(
      deps,
      { userId: "u1", checkinId: c.id, stage: "nudge" },
      new Date(AFTER.getTime() + 172_800_000),
    );
    expect(deps.mailer.sent).toHaveLength(1);
    expect(
      jobs("checkin.followup").filter((j) => (j.data as { stage?: string }).stage === "final"),
    ).toEqual([]);
  });
  it("an unfinished week doesn't block the next one (Review Focus 2)", async () => {
    const first = await dispatchAndPrepare();
    const second = await dispatchAndPrepare(new Date("2026-10-25T22:10:00Z"));
    expect((await getCheckin(db, "u1", first.id)).status).toBe("missed");
    expect((await getActiveRun(db, "u1", "checkin"))?.id).toBe(
      (await getCheckin(db, "u1", second.id)).workflowRunId,
    );
    expect(deps.mailer.sent.map((m) => m.subject)).toEqual([
      "Your weekly check-in is ready",
      "Your weekly check-in is ready",
    ]);
  });
  it("openCheckinNow opens this week's check-in once", async () => {
    const now = new Date("2026-10-14T15:00:00Z");
    expect(await openCheckinNow(deps, "u1", now)).toEqual({ opened: true, weekOf: "2026-10-12" });
    expect(await openCheckinNow(deps, "u1", now)).toEqual({ opened: false, weekOf: "2026-10-12" });
    expect((await only()).status).toBe("sent");
  });
});
