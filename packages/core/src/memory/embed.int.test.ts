import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import {
  embeddingModel,
  fakeLlm,
  fakeQueue,
  seedProvider,
  seedUser,
  testDeps,
} from "../../../../test/integration/fixtures";
import { coreJobs, findMaintenanceWork, JOBS } from "../jobs";
import { addMemory } from "../services/memory";
import { appendMessage, getOrStartSession, setSessionSummary } from "../services/sessions";
import { createStory } from "../services/stories";
import { embedPending } from "./embed";

const db = getTestDb();
let pc: string;
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  pc = await seedProvider(db, "u1", { embedding: "embed-a" });
});

const memory = (content: string) =>
  addMemory(db, "u1", {
    category: "value",
    content,
    sourceType: "manual",
    sourceId: null,
    confidence: 1,
    sensitive: false,
    status: "active",
  });

it("embeds unembedded and foreign-model rows once", async () => {
  const model = embeddingModel({}, [0.5, 0.5]);
  const llm = (id: string) =>
    fakeLlm({ userId: "u1", providerConfigId: pc, models: {}, embedding: { model, modelId: id } });
  for (const content of ["Craft", "Fairness"]) await memory(content);
  expect(await embedPending(testDeps(db), llm("embed-a"), "u1")).toEqual({ embedded: 2 });
  expect(await embedPending(testDeps(db), llm("embed-a"), "u1")).toEqual({ embedded: 0 });
  expect(await embedPending(testDeps(db), llm("embed-b"), "u1")).toEqual({ embedded: 2 });
  const r = await db.execute(sql`select distinct embedding_model from memory_items`);
  expect(r.rows).toEqual([{ embedding_model: "embed-b" }]);
});
it("does nothing without an embedding model", async () => {
  expect(
    await embedPending(
      testDeps(db),
      fakeLlm({ userId: "u1", providerConfigId: pc, models: {} }),
      "u1",
    ),
  ).toEqual({ embedded: 0 });
});
it("embeds stories and session summaries too, and does not overwrite a concurrent edit", async () => {
  await createStory(db, "u1", {
    title: "Zine",
    situation: "Club",
    task: "Publish",
    action: "Drew",
    result: "Sold",
    metrics: null,
    skills: [],
    sourceType: "manual",
    sourceId: null,
  });
  const s = await getOrStartSession(db, "u1");
  const m = await appendMessage(db, "u1", s.id, {
    role: "user",
    parts: [{ type: "text", text: "x" }],
  });
  await setSessionSummary(db, "u1", s.id, { summary: "We talked.", throughMessageId: m.id });
  const item = await memory("Craft");
  const edited = embeddingModel({});
  // The memory is edited while the embedding call is in flight.
  const orig = edited.doEmbed;
  edited.doEmbed = async (o) => {
    await db.execute(
      sql`update memory_items set content = 'Craft!', version = version + 1, embedding = null, embedding_model = null where id = ${item.id}`,
    );
    return orig(o);
  };
  const llm = fakeLlm({
    userId: "u1",
    providerConfigId: pc,
    models: {},
    embedding: { model: edited, modelId: "embed-a" },
  });
  expect(await embedPending(testDeps(db), llm, "u1")).toEqual({ embedded: 2 });
  const r = await db.execute(sql`select embedding_model from memory_items where id = ${item.id}`);
  expect(r.rows).toEqual([{ embedding_model: null }]);
});
it("the maintenance tick enqueues memory.embed, and its handler embeds then clears the work", async () => {
  await memory("Craft");
  const queue = fakeQueue();
  const deps = { ...testDeps(db), queue };
  const tick = coreJobs.find((d) => d.name === JOBS.maintenanceTick);
  await tick?.handler(deps, {});
  expect(queue.sent).toContainEqual({
    name: JOBS.memoryEmbed,
    data: { userId: "u1" },
    opts: { singletonKey: "u1" },
  });
  const def = coreJobs.find((d) => d.name === JOBS.memoryEmbed);
  expect(def?.policy).toBe("stately");
  expect((await findMaintenanceWork(db)).embed).toEqual(["u1"]);
});
