import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { seedUser } from "../../../../../test/integration/fixtures";
import { addMemory } from "../../services/memory";
import { createExperience } from "../../services/profile";
import { createProposal } from "../../services/proposals";
import { computeIntakeCoverage } from "./intake";

const db = getTestDb();
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
});

it("counts memory items, pending memory proposals and a current role", async () => {
  await addMemory(db, "u1", {
    category: "value",
    content: "Autonomy",
    sourceType: "message",
    sourceId: null,
    confidence: 0.9,
    sensitive: false,
    status: "active",
  });
  await createProposal(db, "u1", {
    kind: "memory_add",
    payload: { category: "drain", content: "Night shifts", sensitive: false },
  });
  await createExperience(db, "u1", { title: "Nurse", startDate: "2018" });
  expect(await computeIntakeCoverage(db, "u1")).toEqual({
    covered: ["values", "drains", "current_situation"],
    missing: ["constraints", "energizers", "aspirations"],
  });
});
