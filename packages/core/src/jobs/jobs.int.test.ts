import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { eq, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import {
  FULL_CAPS,
  fakeQueue,
  seedProvider,
  seedUser,
  testDeps,
} from "../../../../test/integration/fixtures";
import { schema } from "../db";
import { generateTextFor } from "../llm";
import { addMemory } from "../services/memory";
import { createSkill } from "../services/profile";
import {
  type AnyJobDefinition,
  ensureQueues,
  findMaintenanceWork,
  pgBossQueue,
  registerJobs,
  withUserLlm,
} from ".";
import { coreJobs } from "./definitions";

const db = getTestDb();
const boss = new PgBoss(inject("databaseUrl"));
beforeAll(() => boss.start());
afterAll(() => boss.stop({ graceful: false }));
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  await seedUser(db, "u2");
});

const jobCount = async (queue: string) =>
  Number(
    (await db.execute<{ n: string }>(sql`select count(*) n from pgboss.job where name = ${queue}`))
      .rows[0]?.n,
  );

const memory = (content: string) => ({
  category: "value" as const,
  content,
  sourceType: "manual" as const,
  sourceId: null,
  confidence: 1,
  sensitive: false,
  status: "active" as const,
});

describe("registerJobs", () => {
  it("creates queues with retry, backoff, and dead letter, schedules cron, and runs handlers", async () => {
    const seen: unknown[] = [];
    const defs: AnyJobDefinition[] = [
      {
        name: "test.echo",
        schema: z.object({ n: z.number() }),
        handler: async (_d, data) => {
          seen.push(data);
        },
      },
      { name: "test.cron", schema: z.object({}), handler: async () => {}, cron: "*/5 * * * *" },
    ];
    await ensureQueues(boss, defs); // init ran first; registerJobs must tolerate existing queues
    await registerJobs(boss, { ...testDeps(db), queue: pgBossQueue(boss) }, defs);
    expect(await boss.getQueue("test.echo")).toMatchObject({
      retryLimit: 3,
      retryBackoff: true,
      deadLetter: "test.echo.dead",
    });
    expect(await boss.getQueue("test.echo.dead")).not.toBeNull();
    expect((await boss.getSchedules()).map((s) => s.name)).toContain("test.cron");
    await pgBossQueue(boss).send("test.echo", { n: 1 });
    await vi.waitFor(() => expect(seen).toEqual([{ n: 1 }]), { timeout: 15_000, interval: 250 });
  });
  it("runs a job that arrives without data (as a data-less cron does) through the wrapper", async () => {
    const seen: unknown[] = [];
    const defs: AnyJobDefinition[] = [
      {
        name: "test.nodata",
        schema: z.object({}),
        handler: async (_d, data) => {
          seen.push(data);
        },
        cron: "*/5 * * * *",
      },
    ];
    await registerJobs(boss, { ...testDeps(db), queue: pgBossQueue(boss) }, defs);
    const [schedule] = await boss.getSchedules("test.nodata");
    expect(schedule?.data).toEqual({});
    await boss.send("test.nodata", null);
    await vi.waitFor(() => expect(seen).toEqual([{}]), { timeout: 15_000, interval: 250 });
  });
  it("sends invalid payloads to the dead-letter queue", async () => {
    const defs: AnyJobDefinition[] = [
      { name: "test.strict", schema: z.object({ n: z.number() }), handler: async () => {} },
    ];
    await registerJobs(boss, { ...testDeps(db), queue: pgBossQueue(boss) }, defs);
    await boss.updateQueue("test.strict", { retryLimit: 0 });
    await boss.send("test.strict", { n: "nope" });
    await vi.waitFor(async () => expect(await jobCount("test.strict.dead")).toBe(1), {
      timeout: 20_000,
      interval: 250,
    });
  });
  it("honours singletonKey on stately queues", async () => {
    const defs: AnyJobDefinition[] = [
      {
        name: "test.stately",
        schema: z.object({ userId: z.string() }),
        handler: async () => {},
        policy: "stately",
      },
    ];
    await ensureQueues(boss, defs);
    const queue = pgBossQueue(boss);
    await queue.send(
      "test.stately",
      { userId: "u1" },
      { singletonKey: "u1", startAfterSeconds: 60 },
    );
    await queue.send(
      "test.stately",
      { userId: "u1" },
      { singletonKey: "u1", startAfterSeconds: 60 },
    );
    expect(await jobCount("test.stately")).toBe(1);
  });
  it("recreates an existing queue whose policy is wrong", async () => {
    await boss.createQueue("test.wrongpolicy");
    await ensureQueues(boss, [
      {
        name: "test.wrongpolicy",
        schema: z.object({}),
        handler: async () => {},
        policy: "stately",
      },
    ]);
    expect(await boss.getQueue("test.wrongpolicy")).toMatchObject({
      policy: "stately",
      retryLimit: 3,
    });
  });
  it("registers the maintenance tick every minute", () => {
    expect(coreJobs.find((d) => d.name === "maintenance.tick")?.cron).toBe("* * * * *");
  });
});

describe("withUserLlm", () => {
  it("skips users without a provider", async () => {
    const fn = vi.fn();
    expect(await withUserLlm(testDeps(db), "u1", fn)).toBe("no_provider");
    expect(fn).not.toHaveBeenCalled();
  });
  it("returns auth_failed on a 401 without marking the config itself (the llm layer does)", async () => {
    const id = await seedProvider(db, "u1");
    const unauthorized = new APICallError({
      message: "Unauthorized",
      url: "http://x",
      requestBodyValues: {},
      statusCode: 401,
      isRetryable: false,
    });
    expect(
      await withUserLlm(testDeps(db), "u1", async () => {
        throw unauthorized;
      }),
    ).toBe("auth_failed");
    const row = async () =>
      (await db.select().from(schema.providerConfigs).where(eq(schema.providerConfigs.id, id)))[0];
    expect(await row()).toMatchObject({ authFailed: false, status: "full" });
  });
  it("leaves marking to generateTextFor, after which the user has no provider", async () => {
    const id = await seedProvider(db, "u1");
    const denied = new APICallError({
      message: "Unauthorized",
      url: "http://x",
      requestBodyValues: {},
      statusCode: 401,
      isRetryable: false,
    });
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw denied;
      },
    });
    const deps = testDeps(db);
    expect(
      await withUserLlm(deps, "u1", async (llm) => {
        await generateTextFor(
          deps,
          { ...llm, capabilities: FULL_CAPS, model: () => model },
          { role: "fast", purpose: "test", instructions: "x", prompt: "y" },
        );
      }),
    ).toBe("auth_failed");
    const [row] = await db
      .select()
      .from(schema.providerConfigs)
      .where(eq(schema.providerConfigs.id, id));
    expect(row).toMatchObject({ authFailed: true, status: "degraded" });
    expect(await withUserLlm(deps, "u1", vi.fn())).toBe("no_provider");
  });
  it("rethrows other errors so pg-boss retries", async () => {
    await seedProvider(db, "u1");
    await expect(
      withUserLlm(testDeps(db), "u1", async () => {
        throw new Error("503");
      }),
    ).rejects.toThrow("503");
  });
});

describe("maintenance tick", () => {
  it("finds stale snapshots and unembedded rows for users with an embedding model", async () => {
    await seedProvider(db, "u1", { embedding: "embed-a" });
    await seedProvider(db, "u2");
    await createSkill(db, "u1", {
      name: "Python",
      level: null,
      evidence: null,
      sourceType: "manual",
      sourceId: null,
    });
    await addMemory(db, "u2", memory("Fairness"));
    await addMemory(db, "u1", memory("Craft"));
    expect(await findMaintenanceWork(db)).toEqual({ snapshot: ["u1", "u2"], embed: ["u1"] });
    await db.insert(schema.userSnapshot).values([
      { userId: "u1", content: "x", profileVersion: 99 },
      { userId: "u2", content: "x", profileVersion: 99 },
    ]);
    await db.execute(
      sql`update memory_items set embedding = '[1,0]'::vector, embedding_model = 'embed-a' where user_id = 'u1'`,
    );
    expect(await findMaintenanceWork(db)).toEqual({ snapshot: [], embed: [] });
    await db.execute(
      sql`update provider_configs set models = models || '{"embedding":"embed-b"}' where user_id = 'u1'`,
    );
    expect((await findMaintenanceWork(db)).embed).toEqual(["u1"]);
  });
  it("skips embed work for users whose embedding config is unusable", async () => {
    const id = await seedProvider(db, "u1", { embedding: "embed-a" });
    await addMemory(db, "u1", memory("Craft"));
    expect((await findMaintenanceWork(db)).embed).toEqual(["u1"]);
    await db
      .update(schema.providerConfigs)
      .set({ authFailed: true, status: "degraded" })
      .where(eq(schema.providerConfigs.id, id));
    expect((await findMaintenanceWork(db)).embed).toEqual([]);
    await db
      .update(schema.providerConfigs)
      .set({ authFailed: false, status: "unsupported" })
      .where(eq(schema.providerConfigs.id, id));
    expect((await findMaintenanceWork(db)).embed).toEqual([]);
    await db.delete(schema.providerConfigs).where(eq(schema.providerConfigs.id, id));
    expect((await findMaintenanceWork(db)).embed).toEqual([]);
  });
  it("enqueues one job per user with the user id as singleton key", async () => {
    await seedProvider(db, "u1", { embedding: "embed-a" });
    await addMemory(db, "u1", memory("Craft"));
    const queue = fakeQueue();
    await coreJobs
      .find((d) => d.name === "maintenance.tick")
      ?.handler({ ...testDeps(db), queue }, {});
    expect(queue.sent).toEqual([
      { name: "snapshot.refresh", data: { userId: "u1" }, opts: { singletonKey: "u1" } },
      { name: "memory.embed", data: { userId: "u1" }, opts: { singletonKey: "u1" } },
    ]);
  });
});

describe("maintenance.tick to snapshot.refresh", () => {
  it("refreshes a stale snapshot through the real queues", async () => {
    await createSkill(db, "u1", {
      name: "Triage",
      level: null,
      evidence: null,
      sourceType: "manual",
      sourceId: null,
    });
    await registerJobs(boss, { ...testDeps(db), queue: pgBossQueue(boss) }, coreJobs);
    expect(await boss.getQueue("snapshot.refresh")).toMatchObject({ policy: "stately" });
    await boss.send("maintenance.tick", {});
    await vi.waitFor(
      async () => {
        const [row] = await db.select().from(schema.userSnapshot);
        expect(row?.userId).toBe("u1");
      },
      { timeout: 30_000, interval: 250 },
    );
    expect((await findMaintenanceWork(db)).snapshot).toEqual([]);
  });
});
