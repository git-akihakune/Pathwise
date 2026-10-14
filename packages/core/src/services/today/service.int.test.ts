import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { seedUser } from "../../../../../test/integration/fixtures";
import { schema } from "../../db";
import {
  createScheduledCheckin,
  markCompleted,
  markMissed,
  markNudged,
  markSent,
} from "../checkins";
import { addMemory } from "../memory";
import { createPlan } from "../plan";
import { createProposal, rejectProposal } from "../proposals";
import { getUserSettings } from "../settings";
import { getToday } from ".";

const db = getTestDb();
const WED = new Date("2026-10-14T10:00:00Z");
const DUE = new Date("2026-10-18T16:00:00Z"); // Sunday 18:00 in Berlin

beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  await seedUser(db, "u2");
  await getUserSettings(db, "u1");
  await db
    .update(schema.userSettings)
    .set({ timezone: "Europe/Berlin" })
    .where(eq(schema.userSettings.userId, "u1"));
  await createPlan(db, "u1", {
    northStar: "Health data",
    milestones: [],
    actions: [
      { title: "Book a call", weekOf: "2026-10-12" },
      { title: "Later", weekOf: "2026-10-19" },
    ],
  });
});

async function checkin(userId = "u1") {
  const c = await createScheduledCheckin(db, userId, { weekOf: "2026-10-12", dueAt: DUE });
  if (!c) throw new Error("Expected a new check-in");
  return c;
}

async function onboarding(status: "completed" | "active", heard: unknown, userId = "u1") {
  await db.insert(schema.workflowRuns).values({
    userId,
    type: "onboarding",
    stepId: "confirm",
    status,
    state: { heard },
  });
}

describe("getToday", () => {
  it("lists only active-plan actions in the user's local week", async () => {
    const today = await getToday(db, "u1", WED);
    expect(today.weekOf).toBe("2026-10-12");
    expect(today.actions.map((a) => a.title)).toEqual(["Book a call"]);
    expect((await getToday(db, "u1", new Date("2026-10-18T21:30:00Z"))).weekOf).toBe("2026-10-12");
    const monday = await getToday(db, "u1", new Date("2026-10-18T22:00:00Z"));
    expect(monday.weekOf).toBe("2026-10-19");
    expect(monday.actions.map((a) => a.title)).toEqual(["Later"]);
    await createPlan(db, "u1", { northStar: "New plan", milestones: [], actions: [] });
    expect((await getToday(db, "u1", WED)).actions).toEqual([]);
  });

  it("returns empty actions without a plan and uses UTC before timezone detection", async () => {
    const today = await getToday(db, "u2", new Date("2026-10-18T22:00:00Z"));
    expect(today.weekOf).toBe("2026-10-12");
    expect(today.actions).toEqual([]);
    expect(today.onboarding).toBe("not_started");
    expect(today.coachNote).toBeNull();
  });

  it("shows the next check-in when none is open", async () => {
    expect((await getToday(db, "u1", WED)).checkin).toEqual({
      state: "upcoming",
      nextDueAt: DUE,
      nudged: false,
    });
  });

  it.each(["scheduled", "sent", "nudged"] as const)(
    "keeps last week's %s check-in visible on Monday",
    async (status) => {
      const c = await checkin();
      if (status !== "scheduled") await markSent(db, "u1", c.id, DUE);
      if (status === "nudged") await markNudged(db, "u1", c.id, DUE);
      expect((await getToday(db, "u1", new Date("2026-10-19T08:00:00Z"))).checkin).toEqual({
        state: "open",
        nextDueAt: new Date("2026-10-25T17:00:00Z"), // Berlin returns to CET
        nudged: status === "nudged",
      });
    },
  );

  it("shows completed until exactly seven days after due, then upcoming", async () => {
    const c = await checkin();
    await markCompleted(db, "u1", c.id, { summary: "Steady week." });
    expect((await getToday(db, "u1", new Date("2026-10-25T15:59:59.999Z"))).checkin.state).toBe(
      "completed",
    );
    expect((await getToday(db, "u1", new Date("2026-10-25T16:00:00Z"))).checkin.state).toBe(
      "upcoming",
    );
  });

  it("shows missed with the next scheduled moment", async () => {
    const c = await checkin();
    await markMissed(db, "u1", c.id);
    expect((await getToday(db, "u1", new Date("2026-10-26T08:00:00Z"))).checkin).toEqual({
      state: "missed",
      nextDueAt: new Date("2026-11-01T17:00:00Z"),
      nudged: false,
    });
  });

  it("says off when disabled, while an existing open check-in stays visible", async () => {
    await db
      .update(schema.userSettings)
      .set({ checkinEnabled: false })
      .where(eq(schema.userSettings.userId, "u1"));
    expect((await getToday(db, "u1", WED)).checkin).toEqual({
      state: "off",
      nextDueAt: null,
      nudged: false,
    });
    await checkin();
    expect((await getToday(db, "u1", WED)).checkin.state).toBe("open");
  });

  it("uses the newest non-null session summary by last message time", async () => {
    await onboarding("completed", "Onboarding note");
    await db.insert(schema.sessions).values([
      { userId: "u1", summary: "Older note", lastMessageAt: new Date("2026-10-12T10:00:00Z") },
      { userId: "u1", summary: "Latest note", lastMessageAt: WED },
      { userId: "u1", summary: null, lastMessageAt: new Date("2026-10-15T10:00:00Z") },
      { userId: "u2", summary: "Foreign note", lastMessageAt: new Date("2026-10-16T10:00:00Z") },
    ]);
    expect((await getToday(db, "u1", WED)).coachNote).toBe("Latest note");
  });

  it("falls back to completed onboarding heard, cut at a word boundary", async () => {
    const prefix = "Steady progress. ".repeat(16).trim(); // 271 characters
    await onboarding("completed", `${prefix} longer-word ending`);
    const today = await getToday(db, "u1", WED);
    expect(today.coachNote).toBe(prefix);
    expect(today.onboarding).toBe("completed");
  });

  it("keeps a short onboarding note whole", async () => {
    await onboarding("completed", "You want more autonomy.");
    expect((await getToday(db, "u1", WED)).coachNote).toBe("You want more autonomy.");
  });

  it("does not show an unconfirmed or foreign onboarding snapshot", async () => {
    await onboarding("active", "Not yet confirmed");
    await onboarding("completed", "Foreign snapshot", "u2");
    const today = await getToday(db, "u1", WED);
    expect(today.coachNote).toBeNull();
    expect(today.onboarding).toBe("in_progress");
  });

  it("collects only the user's pending memories and proposals", async () => {
    const memory = {
      category: "fact",
      sourceType: "message",
      sourceId: null,
      confidence: 0.9,
      sensitive: true,
      status: "pending",
    } as const;
    await addMemory(db, "u1", { ...memory, content: "Started therapy" });
    await addMemory(db, "u1", { ...memory, content: "Confirmed", status: "active" });
    await addMemory(db, "u2", { ...memory, content: "Foreign memory" });
    const pending = await createProposal(db, "u1", {
      kind: "memory_add",
      payload: { category: "preference", content: "Quiet mornings", sensitive: false },
    });
    const resolved = await createProposal(db, "u1", {
      kind: "memory_add",
      payload: { category: "preference", content: "Old suggestion", sensitive: false },
    });
    await rejectProposal(db, "u1", resolved.id);
    await createProposal(db, "u2", {
      kind: "memory_add",
      payload: { category: "preference", content: "Foreign proposal", sensitive: false },
    });
    await checkin("u2");
    const today = await getToday(db, "u1", WED);
    expect(today.pendingMemories.map((m) => m.content)).toEqual(["Started therapy"]);
    expect(today.pendingProposals.map((p) => p.id)).toEqual([pending.id]);
    expect(today.checkin.state).toBe("upcoming");
  });
});
