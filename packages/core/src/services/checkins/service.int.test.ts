import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { seedUser } from "../../../../../test/integration/fixtures";
import {
  createScheduledCheckin,
  getCheckin,
  latestCheckin,
  markCompleted,
  markMissed,
  markNudged,
  markSent,
  setCheckinEnergy,
} from ".";

const db = getTestDb();
const week = { weekOf: "2026-10-12", dueAt: new Date("2026-10-18T18:00:00Z") };
const mk = async () => {
  const c = await createScheduledCheckin(db, "u1", week);
  if (!c) throw new Error("expected a new check-in");
  return c;
};
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  await seedUser(db, "u2");
});

it("creates one row per user and week", async () => {
  expect(await createScheduledCheckin(db, "u1", week)).toMatchObject({
    status: "scheduled",
    weekOf: "2026-10-12",
  });
  expect(await createScheduledCheckin(db, "u1", week)).toBeNull();
});
it("only transitions from the expected states", async () => {
  const c = await mk();
  const now = new Date("2026-10-18T18:05:00Z");
  expect(await markSent(db, "u1", c.id, now)).toBe(true);
  expect(await markSent(db, "u1", c.id, now)).toBe(false);
  expect(await markNudged(db, "u1", c.id, now)).toBe(true);
  expect(await markMissed(db, "u1", c.id)).toBe(true);
  expect(await markCompleted(db, "u1", c.id, { summary: "late" })).toBe(false);
});
it("completes with a summary, stores energy, and scopes by user", async () => {
  const c = await mk();
  await setCheckinEnergy(db, "u1", c.id, 4);
  expect(await markCompleted(db, "u1", c.id, { summary: "good week" })).toBe(true);
  expect(await getCheckin(db, "u1", c.id)).toMatchObject({
    status: "completed",
    energy: 4,
    summary: "good week",
  });
  expect((await getCheckin(db, "u1", c.id)).completedAt).toBeInstanceOf(Date);
  await expect(getCheckin(db, "u2", c.id)).rejects.toThrow();
  expect(await latestCheckin(db, "u2")).toBeNull();
  expect((await latestCheckin(db, "u1"))?.id).toBe(c.id);
});
it("rejects energy outside 1-5", async () => {
  const c = await mk();
  await expect(setCheckinEnergy(db, "u1", c.id, 6)).rejects.toThrow();
});
