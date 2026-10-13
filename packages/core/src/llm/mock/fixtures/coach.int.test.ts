// The mock-mode path E2E relies on.
import type { UIMessage } from "ai";
import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../../test/integration/db";
import {
  fakeQueue,
  readUIStream,
  seedProvider,
  seedUser,
  testDeps,
} from "../../../../../../test/integration/fixtures";
import { runTurn, type TurnResult } from "../../../agent";
import { ensureInstanceSettings } from "../../../instance";
import { listProposals } from "../../../services/proposals";

const db = getTestDb();
const deps = { ...testDeps(db, { llmMode: "mock" }), queue: fakeQueue() };
const say = async (text: string) => {
  let result: TurnResult | undefined;
  const message: UIMessage = {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  };
  await readUIStream(
    await runTurn(
      deps,
      { userId: "u1", message },
      {
        onTurnEnd: async (r) => {
          result = r;
        },
      },
    ),
  );
  return result as TurnResult;
};
beforeEach(async () => {
  await resetDb(db);
  await ensureInstanceSettings(db);
  await seedUser(db, "u1");
  await seedProvider(db, "u1");
});

it("'remember that' proposes the memory", async () => {
  await say("Please remember that I prefer remote work.");
  expect(await listProposals(db, "u1")).toMatchObject([
    {
      kind: "memory_add",
      payload: { category: "preference", content: "I prefer remote work", sensitive: false },
    },
  ]);
});
it("crisis wording gets the safety response", async () =>
  expect((await say("I can't go on anymore")).text).toContain("Find a Helpline"));
it("anything else gets the default reply", async () =>
  expect((await say("Hello")).text).toBe("Mock coach reply. What would you like to work on?"));
