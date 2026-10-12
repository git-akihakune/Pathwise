import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { seedUser } from "../../../../../test/integration/fixtures";
import { schema } from "../../db";
import { ValidationError } from "../../errors";
import { effectiveTimezone, getUserSettings, updateUserSettings } from ".";

const db = getTestDb();
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
});

describe("user settings", () => {
  it("creates defaults lazily, exactly once, and treats a missing timezone as UTC", async () => {
    const [a, b] = await Promise.all([getUserSettings(db, "u1"), getUserSettings(db, "u1")]);
    expect(a).toEqual({
      providerConfigId: null,
      bluntness: 3,
      timezone: null,
      checkinEnabled: true,
      checkinDay: 0,
      checkinTime: "18:00",
      emailEnabled: true,
      profileVersion: 0,
    });
    expect(b).toEqual(a);
    expect(await db.select().from(schema.userSettings)).toHaveLength(1);
    expect(effectiveTimezone(a)).toBe("UTC");
  });
  it("updates bluntness and timezone, and clears the timezone with null", async () => {
    expect(
      await updateUserSettings(db, "u1", { bluntness: 5, timezone: "Europe/Berlin" }),
    ).toMatchObject({ bluntness: 5, timezone: "Europe/Berlin" });
    expect((await updateUserSettings(db, "u1", { timezone: null })).timezone).toBeNull();
  });
  it("accepts UTC as an explicit timezone", async () => {
    expect((await updateUserSettings(db, "u1", { timezone: "UTC" })).timezone).toBe("UTC");
  });
  it.each([0, 6, 2.5])("rejects bluntness %s", async (bluntness) => {
    await expect(
      updateUserSettings(db, "u1", { bluntness: bluntness as 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
  it.each(["Mars/Olympus", "+01:00", "", "Europe/Berlin; drop table x"])(
    "rejects timezone %j",
    async (tz) => {
      await expect(updateUserSettings(db, "u1", { timezone: tz })).rejects.toBeInstanceOf(
        ValidationError,
      );
    },
  );
});
