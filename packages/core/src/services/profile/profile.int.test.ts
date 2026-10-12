import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { FIXTURE } from "../../../../../test/fixtures/taxonomy/records";
import { getTestDb, resetDb, TAXONOMY_FIXTURE_DIR } from "../../../../../test/integration/db";
import { seedUser } from "../../../../../test/integration/fixtures";
import { ConflictError, NotFoundError } from "../../errors";
import { importTaxonomySnapshot, skillGapsFor, writeSnapshot } from "../../taxonomy";
import { getUserSettings } from "../settings";
import {
  createEducation,
  createExperience,
  createSkill,
  deleteEducation,
  deleteExperience,
  deleteSkill,
  getProfile,
  updateEducation,
  updateExperience,
  updateSkill,
} from ".";

const db = getTestDb();
const profileVersion = async () => (await getUserSettings(db, "u1")).profileVersion;
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  await seedUser(db, "u2");
  await importTaxonomySnapshot(db, TAXONOMY_FIXTURE_DIR);
});

describe("experiences", () => {
  it("lists current roles first, then by start date", async () => {
    await createExperience(db, "u1", { title: "Junior", startDate: "2015", endDate: "2018-06" });
    await createExperience(db, "u1", { title: "Lead", startDate: "2021-03" });
    await createExperience(db, "u1", { title: "Mid", startDate: "2018-07", endDate: "2021-02" });
    expect((await getProfile(db, "u1")).experiences.map((e) => e.title)).toEqual([
      "Lead",
      "Mid",
      "Junior",
    ]);
  });
  it.each([
    [{ title: "" }, "Enter a title."],
    [{ title: "X", startDate: "2019-13" }, "Use YYYY, YYYY-MM or YYYY-MM-DD."],
    [{ title: "X", startDate: "2020", endDate: "2019-05" }, "End date is before start date."],
  ])("rejects %o", async (input, message) => {
    const err = await createExperience(db, "u1", input).catch((e) => e);
    expect(err).toBeInstanceOf(ZodError);
    expect(err.issues[0].message).toBe(message);
  });
  it("checks a patched date against the stored one", async () => {
    const e = await createExperience(db, "u1", { title: "A", startDate: "2020" });
    const err = await updateExperience(db, "u1", e.id, { endDate: "2019" }).catch((x) => x);
    expect(err).toBeInstanceOf(ZodError);
    expect(err.issues[0].message).toBe("End date is before start date.");
  });
  it("versions updates and rejects stale ones without side effects", async () => {
    const e = await createExperience(db, "u1", { title: "Analyst" });
    expect(e).toMatchObject({ version: 1, sourceType: "manual", highlights: [] });
    expect(await updateExperience(db, "u1", e.id, { organization: "Acme" }, 1)).toMatchObject({
      version: 2,
      organization: "Acme",
    });
    const before = await profileVersion();
    await expect(updateExperience(db, "u1", e.id, { title: "Lead" }, 1)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await profileVersion()).toBe(before);
    expect((await updateExperience(db, "u1", e.id, { title: "Lead" })).version).toBe(3);
  });
  it("bumps profile_version on every change", async () => {
    expect(await profileVersion()).toBe(0);
    const e = await createExperience(db, "u1", { title: "Analyst" });
    await updateExperience(db, "u1", e.id, { title: "Senior Analyst" });
    await deleteExperience(db, "u1", e.id);
    expect(await profileVersion()).toBe(3);
    expect((await getProfile(db, "u1")).experiences).toEqual([]);
  });
  it("hides rows from other users", async () => {
    const e = await createExperience(db, "u1", { title: "Mine" });
    expect((await getProfile(db, "u2")).experiences).toEqual([]);
    await expect(updateExperience(db, "u2", e.id, { title: "Hijack" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(deleteExperience(db, "u2", e.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("education", () => {
  it("creates, updates with versioning, and deletes", async () => {
    await expect(createEducation(db, "u1", { institution: "" })).rejects.toBeInstanceOf(ZodError);
    const e = await createEducation(db, "u1", { institution: "MIT", startDate: "2010" });
    expect(await updateEducation(db, "u1", e.id, { field: "CS" }, 1)).toMatchObject({
      version: 2,
      field: "CS",
    });
    await expect(updateEducation(db, "u1", e.id, { field: "Math" }, 1)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(updateEducation(db, "u2", e.id, { field: "X" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await deleteEducation(db, "u1", e.id);
    expect((await getProfile(db, "u1")).education).toEqual([]);
    expect(await profileVersion()).toBe(3);
  });
});

describe("skills and the taxonomy", () => {
  it("links skills by exact name and relinks on rename", async () => {
    const s = await createSkill(db, "u1", { name: "programming", level: "strong" });
    expect(s.taxonomySkillId).toBe("onet:2.B.3.e");
    expect(
      (await updateSkill(db, "u1", s.id, { name: "Basket weaving" })).taxonomySkillId,
    ).toBeNull();
    expect(
      (await createSkill(db, "u1", { name: "Whatever", taxonomySkillId: "onet:nope" }))
        .taxonomySkillId,
    ).toBeNull();
  });
  it("keeps a chosen link when the name is unchanged, and deletes", async () => {
    const s = await createSkill(db, "u1", { name: "Coding", taxonomySkillId: "onet:2.B.3.e" });
    expect(s.taxonomySkillId).toBe("onet:2.B.3.e");
    expect(
      (await updateSkill(db, "u1", s.id, { name: "Coding", level: "expert" })).taxonomySkillId,
    ).toBe("onet:2.B.3.e");
    await deleteSkill(db, "u1", s.id);
    expect((await getProfile(db, "u1")).skills).toEqual([]);
  });
  it("computes skill gaps from important skills the user lacks", async () => {
    await createSkill(db, "u1", { name: "Programming" });
    await createSkill(db, "u1", { name: "Mathematics" }); // links to the skill 2.A.1.e, not the knowledge 2.C.4.a
    expect(await skillGapsFor(db, "u1", "onet:15-1252.00")).toEqual([
      {
        skill: "Computers and Electronics",
        taxonomySkillId: "onet:2.C.3.a",
        importance: 0.88,
        note: "Important for Software Developers",
      },
      {
        skill: "Critical Thinking",
        taxonomySkillId: "onet:2.A.2.a",
        importance: 0.72,
        note: "Important for Software Developers",
      },
    ]);
    await expect(skillGapsFor(db, "u1", "onet:00-0000.00")).rejects.toBeInstanceOf(NotFoundError);
  });
  it("keeps skill links across a taxonomy upgrade unless the skill was removed (Review Focus 3)", async () => {
    await createSkill(db, "u1", { name: "Programming" });
    await createSkill(db, "u1", { name: "Service Orientation" });
    const v2 = mkdtempSync(join(tmpdir(), "tax-"));
    await writeSnapshot(
      v2,
      {
        ...FIXTURE,
        skills: FIXTURE.skills.filter((s) => s.id !== "onet:2.B.1.f"),
        occupationSkills: FIXTURE.occupationSkills.filter((x) => x.skillId !== "onet:2.B.1.f"),
      },
      { onet: null, esco: null, crosswalk: null },
    );
    await importTaxonomySnapshot(db, v2);
    expect((await getProfile(db, "u1")).skills.map((s) => [s.name, s.taxonomySkillId])).toEqual([
      ["Programming", "onet:2.B.3.e"],
      ["Service Orientation", null],
    ]);
  });
});
