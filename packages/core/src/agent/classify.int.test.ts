import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import {
  fakeLlm,
  jsonReply,
  seedProvider,
  seedUser,
  testDeps,
} from "../../../../test/integration/fixtures";
import { schema } from "../db";
import { classify } from "./classify";
import { registerSkill } from "./registry";

const db = getTestDb();
let pc: string;
const deps = testDeps(db);
const stub = (id: "direction" | "planning", description: string) =>
  registerSkill({ id, description, promptFragment: () => "", tools: () => ({}) });
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  pc = await seedProvider(db, "u1");
  stub("direction", "Exploring careers and options");
  stub("planning", "Making or changing the plan");
});
const llmWith = (m: MockLanguageModelV4) =>
  fakeLlm({ userId: "u1", providerConfigId: pc, models: { classify: m } });
const apiError = (statusCode: number) =>
  new APICallError({
    message: "boom",
    url: "x",
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });

it("returns known skills and distress, records usage, and describes the skills to the model", async () => {
  const fast = new MockLanguageModelV4({
    doGenerate: jsonReply({ skills: ["direction", "astrology"], distress: "elevated" }),
  });
  expect(
    await classify(deps, llmWith(fast), { text: "What else could I do?", history: [] }),
  ).toEqual({ skills: ["direction"], distress: "elevated" });
  expect(JSON.stringify(fast.doGenerateCalls[0]?.prompt)).toContain(
    "direction: Exploring careers and options",
  );
  expect(
    await db.select().from(schema.llmUsage).where(eq(schema.llmUsage.purpose, "classify")),
  ).toHaveLength(1);
});
it("raises distress from keywords when the model misses it (Review Focus 1)", async () => {
  const fast = new MockLanguageModelV4({
    doGenerate: jsonReply({ skills: [], distress: "none" }),
  });
  expect(
    (await classify(deps, llmWith(fast), { text: "I can't go on", history: [] })).distress,
  ).toBe("acute");
});
it("falls back to no skills and keyword distress when the model fails (Review Focus 1)", async () => {
  const fast = new MockLanguageModelV4({
    doGenerate: async () => {
      throw apiError(500);
    },
  });
  expect(
    await classify(deps, llmWith(fast), { text: "I want to end my life", history: [] }),
  ).toEqual({ skills: [], distress: "acute" });
});
it("rethrows auth errors", async () => {
  const fast = new MockLanguageModelV4({
    doGenerate: async () => {
      throw apiError(401);
    },
  });
  await expect(classify(deps, llmWith(fast), { text: "hi", history: [] })).rejects.toBeInstanceOf(
    APICallError,
  );
});
it("keeps the distress verdict when the model returns more than 4 skills, and caps skills at 4", async () => {
  for (const id of ["core", "intake", "checkin"] as const)
    registerSkill({ id, description: id, promptFragment: () => "", tools: () => ({}) });
  const fast = new MockLanguageModelV4({
    doGenerate: jsonReply({
      skills: ["direction", "planning", "a", "b", "c"],
      distress: "acute",
    }),
  });
  const out = await classify(deps, llmWith(fast), { text: "hello there", history: [] });
  expect(out.distress).toBe("acute");
  expect(out.skills.length).toBeLessThanOrEqual(4);
  expect(out.skills).toEqual(["direction", "planning"]);
});
it("falls back to keyword distress when prompt assembly throws", async () => {
  const fast = new MockLanguageModelV4({ doGenerate: jsonReply({ skills: [], distress: "none" }) });
  const history = [
    {
      id: "m",
      role: "user",
      get parts(): never {
        throw new Error("bad");
      },
    },
  ];
  expect(
    await classify(deps, llmWith(fast), {
      text: "I want to end my life",
      history: history as never,
    }),
  ).toEqual({ skills: [], distress: "acute" });
});
