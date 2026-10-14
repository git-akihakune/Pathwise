import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import {
  embeddingModel,
  fakeLlm,
  seedProvider,
  seedUser,
  testDeps,
} from "../../../../test/integration/fixtures";
import { addMemory } from "../services/memory";
import { coreJobs, JOBS, pgBossQueue, registerJobs } from ".";

vi.mock("../llm/resolve", async (orig) => ({
  ...(await orig<typeof import("../llm/resolve")>()),
  resolveLlm: vi.fn(),
}));
const { resolveLlm } = await import("../llm/resolve");

const db = getTestDb();
const boss = new PgBoss(inject("databaseUrl"));
beforeAll(() => boss.start());
afterAll(() => boss.stop({ graceful: false }));

it("a maintenance tick enqueues memory.embed, whose handler embeds the user's rows", async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  const pc = await seedProvider(db, "u1", { embedding: "embed-a" });
  vi.mocked(resolveLlm).mockResolvedValue(
    fakeLlm({
      userId: "u1",
      providerConfigId: pc,
      models: {},
      embedding: { model: embeddingModel({}, [1, 0]), modelId: "embed-a" },
    }),
  );
  await addMemory(db, "u1", {
    category: "value",
    content: "Craft",
    sourceType: "manual",
    sourceId: null,
    confidence: 1,
    sensitive: false,
    status: "active",
  });
  await registerJobs(boss, { ...testDeps(db), queue: pgBossQueue(boss) }, [
    ...coreJobs,
    // Stand-in until snapshot.refresh is defined: the tick also finds snapshot work for this user.
    {
      name: JOBS.snapshotRefresh,
      policy: "stately",
      schema: z.object({ userId: z.string() }),
      handler: async () => {},
    },
  ]);
  expect(await boss.getQueue(JOBS.memoryEmbed)).toMatchObject({ policy: "stately" });
  await boss.send(JOBS.maintenanceTick, {});
  await vi.waitFor(
    async () => {
      const r = await db.execute(sql`select embedding_model from memory_items`);
      expect(r.rows).toEqual([{ embedding_model: "embed-a" }]);
    },
    { timeout: 20_000, interval: 500 },
  );
}, 40_000);
