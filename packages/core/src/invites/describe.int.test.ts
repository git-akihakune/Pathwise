import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { schema } from "../db";
import { createInvite, describeInvite, markInviteUsed } from "./service";

const db = getTestDb();
beforeEach(async () => {
  await resetDb(db);
  await db
    .insert(schema.user)
    .values({ id: "adm", name: "A", email: "a@x.io", emailVerified: false, role: "admin" });
});

it("describes each invite state (Review Focus 5)", async () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const later = new Date("2026-02-01T00:00:00Z");
  const usable = await createInvite(db, { email: "u@x.io", createdBy: "adm", now });
  const used = await createInvite(db, { email: "d@x.io", createdBy: "adm", now });
  await markInviteUsed(db, used.invite.id, "adm", now);
  expect(await describeInvite(db, usable.token, now)).toEqual({
    status: "usable",
    email: "u@x.io",
  });
  expect(await describeInvite(db, usable.token, later)).toEqual({
    status: "expired",
    email: "u@x.io",
  });
  expect(await describeInvite(db, used.token, later)).toEqual({ status: "used", email: "d@x.io" });
  expect(await describeInvite(db, "not-a-real-token")).toEqual({ status: "unknown" });
});
