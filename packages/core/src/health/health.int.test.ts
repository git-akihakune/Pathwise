import { expect, it } from "vitest";
import { getTestDb } from "../../../../test/integration/db";
import { createDb } from "../db";
import { checkHealth } from ".";

it("reports a reachable database as healthy", async () => {
  expect(await checkHealth(getTestDb())).toBe(true);
});
it("reports an unreachable database as unhealthy instead of throwing", async () => {
  const { db, pool } = createDb("postgres://x:y@127.0.0.1:1/none", {
    connectionTimeoutMillis: 500,
  });
  expect(await checkHealth(db)).toBe(false);
  await pool.end();
});
