import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { seedUser } from "../../../../test/integration/fixtures";
import { schema } from "../db";
import { ForbiddenError } from "../errors";
import { ensureInstanceSettings, getSafetyResources } from "../instance";
import { setSafetyResources } from "./service";

const db = getTestDb();
beforeEach(async () => {
  await resetDb(db);
  await ensureInstanceSettings(db);
  await seedUser(db, "adm", "admin");
  await seedUser(db, "usr");
});

const DEFAULT = [{ name: "Find a Helpline", url: "https://findahelpline.com" }];

it("defaults to Find a Helpline", async () =>
  expect(await getSafetyResources(db)).toEqual(DEFAULT));
it("lets admins replace the list, with validation", async () => {
  const list = [{ name: "Samaritans", url: "https://www.samaritans.org" }];
  await setSafetyResources(db, "adm", list);
  expect(await getSafetyResources(db)).toEqual(list);
  await expect(setSafetyResources(db, "adm", [])).rejects.toThrow(
    "Add at least one safety resource.",
  );
  await expect(
    setSafetyResources(db, "adm", [{ name: "X", url: "javascript:alert(1)" }]),
  ).rejects.toThrow("Each resource needs a name and an http(s) URL.");
  await expect(setSafetyResources(db, "usr", list)).rejects.toBeInstanceOf(ForbiddenError);
});
it("falls back to the default list when the row is missing (R13: the crisis path must not throw)", async () => {
  await db.delete(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1));
  expect(await getSafetyResources(db)).toEqual(DEFAULT);
});
it("falls back to the default list when the column is missing or malformed", async () => {
  await db.execute(sql`update instance_settings set safety_resources = '[]'::jsonb`);
  expect(await getSafetyResources(db)).toEqual(DEFAULT);
  await db.execute(sql`alter table instance_settings drop column safety_resources`);
  try {
    expect(await getSafetyResources(db)).toEqual(DEFAULT);
  } finally {
    // the database is shared across test files: restore the column exactly as the migration made it
    await db.execute(
      sql`alter table instance_settings add column safety_resources jsonb not null default '[{"name":"Find a Helpline","url":"https://findahelpline.com"}]'::jsonb`,
    );
  }
});
it("accepts upper-case schemes and still rejects non-http schemes", async () => {
  const list = [{ name: "Upper", url: "HTTPS://example.org/help" }];
  await setSafetyResources(db, "adm", list);
  expect((await getSafetyResources(db))[0]?.name).toBe("Upper");
  await expect(
    setSafetyResources(db, "adm", [{ name: "X", url: "JavaScript:alert(1)" }]),
  ).rejects.toThrow("Each resource needs a name and an http(s) URL.");
  await expect(
    setSafetyResources(db, "adm", [{ name: "X", url: "ftp://example.org" }]),
  ).rejects.toThrow("Each resource needs a name and an http(s) URL.");
});
