import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { seedUser } from "../../../../../test/integration/fixtures";
import { ValidationError } from "../../errors";
import { updateCheckinSchedule } from ".";

const db = getTestDb();
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
});

it("saves a valid schedule and returns before/after", async () => {
  const { before, after } = await updateCheckinSchedule(db, "u1", {
    enabled: true,
    day: 3,
    time: "07:30",
    emailEnabled: false,
  });
  expect(before).toMatchObject({ checkinDay: 0, checkinTime: "18:00", emailEnabled: true });
  expect(after).toMatchObject({
    checkinEnabled: true,
    checkinDay: 3,
    checkinTime: "07:30",
    emailEnabled: false,
  });
});
it.each([
  [{ enabled: true, day: 7, time: "07:30", emailEnabled: true }],
  [{ enabled: true, day: 1, time: "24:00", emailEnabled: true }],
  [{ enabled: true, day: 1, time: "7:30", emailEnabled: true }],
])("rejects %o", async (input) => {
  await expect(updateCheckinSchedule(db, "u1", input)).rejects.toBeInstanceOf(ValidationError);
});
