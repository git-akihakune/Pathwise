import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { fakeMailer, seedUser, workflowDeps } from "../../../../test/integration/fixtures";
import { getUserSettings } from "../services/settings";
import { sendCheckinCalendar } from "./calendar";

const db = getTestDb();
const { config } = workflowDeps(db);
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
});

it("sends REQUEST then CANCEL with the same UID and increasing SEQUENCE", async () => {
  const mailer = fakeMailer();
  const now = new Date("2026-10-12T09:30:00Z");
  await sendCheckinCalendar({ db, config, mailer }, "u1", "REQUEST", now);
  await sendCheckinCalendar({ db, config, mailer }, "u1", "CANCEL", now);
  const [a, b] = mailer.sent;
  expect(a?.ics?.content).toContain("UID:checkin-u1@coach.example.com\r\n");
  expect(a?.ics?.content).toContain("SEQUENCE:0\r\n");
  expect(a?.ics?.content).toContain("DTSTART;TZID=UTC:20261018T180000\r\n");
  expect(b?.ics?.content).toContain("SEQUENCE:1\r\n");
  expect(b?.subject).toBe("Weekly Pathwise check-in cancelled");
  expect((await getUserSettings(db, "u1")).checkinIcsSequence).toBe(2);
});

it("uses the bare address of a display-name From as organizer", async () => {
  const mailer = fakeMailer();
  const smtp = {
    host: "h",
    port: 587,
    user: null,
    pass: null,
    from: "Pathwise <coach@example.com>",
  };
  await sendCheckinCalendar(
    { db, config: { ...config, smtp }, mailer },
    "u1",
    "REQUEST",
    new Date("2026-10-12T09:30:00Z"),
  );
  expect(mailer.sent[0]?.ics?.content).toContain(
    "ORGANIZER;CN=Pathwise:mailto:coach@example.com\r\n",
  );
});
