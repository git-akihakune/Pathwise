import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { seedUser } from "../../../../test/integration/fixtures";
import { discardDeadLetter, getJobHealth, retryDeadLetter } from "../admin";
import { ForbiddenError, NotFoundError } from "../errors";
import { type JobAdmin, pgBossJobAdmin } from "./admin";

const db = getTestDb();
const boss = new PgBoss({
  connectionString: inject("databaseUrl"),
  schema: "pgboss_admin",
  supervise: false,
  schedule: false,
});
let jobs: JobAdmin;
beforeAll(async () => {
  await boss.start();
  jobs = pgBossJobAdmin(boss);
});
afterAll(() => boss.stop({ graceful: false }));
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "adm", "admin");
  await seedUser(db, "usr");
  // resetDb only resets public; leave no queue jobs across these tests.
  for (const q of await boss.getQueues()) await boss.deleteAllJobs(q.name);
});

async function queueWithDeadLetter() {
  const name = `t${randomUUID().slice(0, 8)}`;
  await boss.createQueue(`${name}.dead`);
  await boss.createQueue(name, { retryLimit: 0, deadLetter: `${name}.dead` });
  return name;
}
async function deadLetter(name: string, data: object, output: object = { message: "boom" }) {
  const id = await boss.send(name, data);
  assert(id);
  const original = await boss.getJobById(name, id);
  assert(original);
  const [job] = await boss.fetch(name);
  assert(job);
  await boss.fail(name, job.id, output);
  return original;
}

describe("job admin", () => {
  it("reports source queue counts including active jobs and folds in dead letters", async () => {
    const q = await queueWithDeadLetter();
    await deadLetter(q, { userId: "u1" });
    await boss.send(q, {});
    await boss.fetch(q);
    await boss.send(q, { userId: "u1" });
    await boss.send(q, { userId: "u2" });
    const plain = `t${randomUUID().slice(0, 8)}`;
    await boss.createQueue(plain);
    const health = await jobs.queueHealth();
    expect(health.find((h) => h.name === q)).toEqual({
      name: q,
      queued: 2,
      active: 1,
      failed: 1,
      deadLettered: 1,
    });
    expect(health.find((h) => h.name === plain)?.deadLettered).toBe(0);
    expect(health.some((h) => h.name.endsWith(".dead") || h.name.startsWith("__"))).toBe(false);
    expect(health.map((h) => h.name)).toEqual(health.map((h) => h.name).sort());
  });

  it("lists newest dead letters with original times and bounded metadata, never payloads", async () => {
    const q = await queueWithDeadLetter();
    const original = await deadLetter(
      q,
      { userId: "u-dl", note: "PRIVATE-NOTE" },
      { message: "x".repeat(350), secret: "PRIVATE-ERROR" },
    );
    await setTimeout(5);
    await deadLetter(q, { userId: 42 }, { message: 42 });
    const letters = await jobs.listDeadLetters();
    expect(letters).toHaveLength(2);
    expect(letters[0]).toMatchObject({ userId: null, lastError: null });
    expect(letters[1]).toEqual({
      id: expect.any(String),
      queue: `${q}.dead`,
      sourceQueue: q,
      createdOn: original.createdOn,
      deadLetteredOn: expect.any(Date),
      lastError: "x".repeat(300),
      userId: "u-dl",
    });
    expect(letters[1]?.deadLetteredOn.getTime()).toBeGreaterThanOrEqual(
      original.createdOn.getTime(),
    );
    expect(JSON.stringify(letters)).not.toContain("PRIVATE");
    expect(await jobs.listDeadLetters(1)).toEqual([letters[0]]);
    expect(await jobs.listDeadLetters(0)).toEqual([]);
  });

  it("defaults to the newest 50 dead letters", async () => {
    const q = await queueWithDeadLetter();
    for (let i = 0; i < 50; i++) await boss.send(`${q}.dead`, { userId: String(i) });
    // pg returns timestamps at millisecond precision; make the newest job unambiguous.
    await setTimeout(5);
    await boss.send(`${q}.dead`, { userId: "50" });
    const letters = await jobs.listDeadLetters();
    expect(letters).toHaveLength(50);
    expect(letters[0]?.userId).toBe("50");
    expect(letters[0]?.sourceQueue).toBe(q);
    expect(letters[0]?.createdOn).toEqual(letters[0]?.deadLetteredOn);
  });

  it("retries on the source queue preserving payload and discards another", async () => {
    const q = await queueWithDeadLetter();
    await deadLetter(q, { userId: "a" });
    await deadLetter(q, { userId: "b", note: "retained" });
    const letters = await jobs.listDeadLetters();
    const x = letters.find((job) => job.userId === "b");
    const y = letters.find((job) => job.userId === "a");
    assert(x && y);
    await retryDeadLetter(db, jobs, "adm", x);
    await discardDeadLetter(db, jobs, "adm", y);
    expect((await boss.findJobs(q, { queued: true })).map((j) => j.data)).toEqual([
      { userId: "b", note: "retained" },
    ]);
    expect(await boss.findJobs(`${q}.dead`, { queued: true })).toHaveLength(0);
    await expect(retryDeadLetter(db, jobs, "adm", x)).rejects.toBeInstanceOf(NotFoundError);
    await expect(discardDeadLetter(db, jobs, "adm", y)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects source, missing, and unregistered dead-letter queues for both actions", async () => {
    const q = await queueWithDeadLetter();
    const fake = `${randomUUID().slice(0, 8)}.dead`;
    await boss.createQueue(fake);
    const id = await boss.send(q, { userId: "stays" });
    const fakeId = await boss.send(fake, {});
    assert(id && fakeId);
    for (const ref of [
      { queue: q, id },
      { queue: fake, id: fakeId },
      { queue: "missing.dead", id: randomUUID() },
    ]) {
      expect(await jobs.retryDeadLetter(ref)).toBe(false);
      expect(await jobs.discardDeadLetter(ref)).toBe(false);
    }
    expect(await boss.getJobById(q, id)).not.toBeNull();
    expect(await boss.getJobById(fake, fakeId)).not.toBeNull();
  });

  it("cancels only that user's queued source jobs and deletes their dead letters", async () => {
    const q = await queueWithDeadLetter();
    await deadLetter(q, { userId: "stays" });
    await deadLetter(q, { userId: "gone" });
    await boss.send(q, { userId: "gone" });
    const [active] = await boss.fetch(q);
    await boss.send(q, { userId: "gone" });
    await boss.send(q, { userId: "stays" });
    await boss.send(q, {});
    const retryQueue = `t${randomUUID().slice(0, 8)}`;
    await boss.createQueue(retryQueue, { retryLimit: 1, retryDelay: 100 });
    const retryId = await boss.send(retryQueue, { userId: "gone" });
    const [retry] = await boss.fetch(retryQueue);
    assert(active && retry && retryId);
    await boss.fail(retryQueue, retry.id, {});
    expect(await jobs.cancelUserJobs("gone")).toBe(3);
    expect(await boss.getJobById(q, active.id)).toMatchObject({ state: "active" });
    expect(await boss.getJobById(retryQueue, retryId)).toMatchObject({ state: "cancelled" });
    expect((await boss.findJobs(q, { queued: true })).map((j) => j.data)).toEqual(
      expect.arrayContaining([{ userId: "stays" }, {}]),
    );
    expect(await boss.findJobs(q, { queued: true })).toHaveLength(2);
    expect(await boss.findJobs(`${q}.dead`, { data: { userId: "gone" } })).toHaveLength(0);
    expect((await jobs.listDeadLetters()).map((job) => job.userId)).toEqual(["stays"]);
    expect(await jobs.cancelUserJobs("gone")).toBe(0);
  });

  it("gates health, retry, and discard before accessing queues", async () => {
    const q = await queueWithDeadLetter();
    await deadLetter(q, { userId: "usr" });
    const [ref] = await jobs.listDeadLetters();
    assert(ref);
    for (const actor of ["usr", "missing"]) {
      await expect(getJobHealth(db, jobs, actor)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(retryDeadLetter(db, jobs, actor, ref)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(discardDeadLetter(db, jobs, actor, ref)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await jobs.listDeadLetters()).toHaveLength(1);
    await expect(getJobHealth(db, jobs, "adm")).resolves.toHaveProperty("queues");
  });
});
