import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import {
  embeddingModel,
  fakeLlm,
  seedProvider,
  seedUser,
  testDeps,
} from "../../../../test/integration/fixtures";
import { addMemory } from "../services/memory";
import { appendMessage, getOrStartSession, setSessionSummary } from "../services/sessions";
import { createStory } from "../services/stories";
import { hybridSearch } from "./retrieval";

const db = getTestDb();
const deps = testDeps(db);
const mem = (userId: string, content: string, status: "active" | "pending" = "active") =>
  addMemory(db, userId, {
    category: "energizer",
    content,
    sourceType: "manual",
    sourceId: null,
    confidence: 1,
    sensitive: false,
    status,
  });
const setVec = (id: string, vec: number[], model: string) =>
  db.execute(
    sql`update memory_items set embedding = ${JSON.stringify(vec)}::vector, embedding_model = ${model} where id = ${id}`,
  );
let pc: string;
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  await seedUser(db, "u2");
  pc = await seedProvider(db, "u1");
});

describe("hybridSearch", () => {
  it("ranks active memories, stories, and session summaries by full text, for this user only (Review Focus 5)", async () => {
    await mem("u1", "Loves drawing comics");
    await mem("u1", "Drawing classes on weekends", "pending");
    await mem("u1", "Hates commuting");
    await mem("u2", "Loves drawing too");
    await createStory(db, "u1", {
      title: "Zine",
      situation: "Club",
      task: "Publish",
      action: "Drew and printed a zine",
      result: "Sold out",
      metrics: null,
      skills: ["drawing"],
      sourceType: "manual",
      sourceId: null,
    });
    const s = await getOrStartSession(db, "u1");
    const m = await appendMessage(db, "u1", s.id, {
      role: "user",
      parts: [{ type: "text", text: "x" }],
    });
    await setSessionSummary(db, "u1", s.id, {
      summary: "We discussed drawing for a living.",
      throughMessageId: m.id,
    });
    const r = await hybridSearch(deps, null, "u1", "drawing jobs");
    expect(r.map((i) => i.kind).sort()).toEqual(["memory", "session", "story"]);
    expect(r.find((i) => i.kind === "memory")?.text).toBe("Loves drawing comics");
  });
  it("excludes one session when asked", async () => {
    const s = await getOrStartSession(db, "u1");
    const m = await appendMessage(db, "u1", s.id, {
      role: "user",
      parts: [{ type: "text", text: "x" }],
    });
    await setSessionSummary(db, "u1", s.id, {
      summary: "We discussed drawing for a living.",
      throughMessageId: m.id,
    });
    expect(await hybridSearch(deps, null, "u1", "drawing", { excludeSessionId: s.id })).toEqual([]);
    expect(await hybridSearch(deps, null, "u1", "drawing")).toHaveLength(1);
  });
  it("adds vector matches only from the current embedding model (Review Focus 5)", async () => {
    const same = await mem("u1", "Enjoys illustrating children's books");
    const other = await mem("u1", "Likes painting murals");
    const foreign = await mem("u2", "Enjoys illustrating posters");
    await setVec(same.id, [1, 0, 0], "embed-a");
    await setVec(other.id, [1, 0, 0], "embed-b");
    await setVec(foreign.id, [1, 0, 0], "embed-a");
    const llm = fakeLlm({
      userId: "u1",
      providerConfigId: pc,
      models: {},
      embedding: { model: embeddingModel({ "creative work": [1, 0, 0] }), modelId: "embed-a" },
    });
    expect((await hybridSearch(deps, llm, "u1", "creative work")).map((i) => i.id)).toEqual([
      same.id,
    ]);
  });
  it("still finds rows by full text after the embedding model changes (Review Focus 5)", async () => {
    const a = await mem("u1", "Loves drawing comics");
    await setVec(a.id, [0, 1, 0], "embed-old");
    const llm = fakeLlm({
      userId: "u1",
      providerConfigId: pc,
      models: {},
      embedding: { model: embeddingModel({}), modelId: "embed-new" },
    });
    expect((await hybridSearch(deps, llm, "u1", "drawing")).map((i) => i.id)).toEqual([a.id]);
  });
});
