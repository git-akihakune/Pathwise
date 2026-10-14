import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { seedUser } from "../../../../../test/integration/fixtures";
import { schema } from "../../db";
import { ForbiddenError } from "../../errors";
import { usageByUser } from ".";

const db = getTestDb();
const day = 86_400_000;
const row = (
  userId: string,
  role: string,
  inputTokens: number,
  outputTokens: number,
  ageDays = 0,
) => ({
  userId,
  role,
  inputTokens,
  outputTokens,
  model: "m",
  purpose: "chat",
  createdAt: new Date(Date.now() - ageDays * day),
});
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "adm", "admin");
  await seedUser(db, "u1");
  await seedUser(db, "u2");
  await db
    .insert(schema.llmUsage)
    .values([
      row("u1", "main", 100, 10),
      row("u1", "main", 50, 5),
      row("u1", "fast", 7, 3),
      row("u1", "main", 1000, 1000, 40),
      row("adm", "embedding", 12, 0),
    ]);
});

it("sums tokens per user and role since a date", async () => {
  expect(await usageByUser(db, "adm", new Date(Date.now() - 30 * day))).toEqual([
    { userId: "adm", email: "adm@x.io", role: "embedding", inputTokens: 12, outputTokens: 0 },
    { userId: "u1", email: "u1@x.io", role: "main", inputTokens: 150, outputTokens: 15 },
    { userId: "u1", email: "u1@x.io", role: "fast", inputTokens: 7, outputTokens: 3 },
  ]);
});
it("is admin-only", async () => {
  await expect(usageByUser(db, "u1", new Date(0))).rejects.toBeInstanceOf(ForbiddenError);
});
