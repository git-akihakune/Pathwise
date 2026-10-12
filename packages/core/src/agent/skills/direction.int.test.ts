import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb, TAXONOMY_FIXTURE_DIR } from "../../../../../test/integration/db";
import {
  fakeLlm,
  jsonReply,
  runTool,
  seedProvider,
  seedUser,
  testDeps,
} from "../../../../../test/integration/fixtures";
import { StructuredOutputError } from "../../llm";
import { createExperience, createSkill } from "../../services/profile";
import { listProposals } from "../../services/proposals";
import { appendMessage, getOrStartSession } from "../../services/sessions";
import { importTaxonomySnapshot } from "../../taxonomy";
import { getSkill } from "..";
import { generateCareerPaths } from "./career-paths";

const db = getTestDb();
const deps = testDeps(db);
let pc: string;
const path = (title: string, codes: string[], gaps: { skill: string; note: string }[]) => ({
  title,
  occupationCodes: codes,
  rationale: "Builds on years of patient care.",
  route: [{ title: "Charge nurse", kind: "role", detail: "Bridge role", isBridgeRole: true }],
  skillGaps: gaps.map((g) => ({ ...g, taxonomySkillId: null, importance: 0.5 })),
  feasibility: {
    timeMonths: { min: 12, max: 24 },
    cost: "Estimate: course fees vary",
    risks: ["Shift work"],
    mustBeTrue: ["Can study part-time"],
  },
});
const llmWith = (m: MockLanguageModelV4) =>
  fakeLlm({ userId: "u1", providerConfigId: pc, models: { "paths.generate": m } });

beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  pc = await seedProvider(db, "u1");
  await importTaxonomySnapshot(db, TAXONOMY_FIXTURE_DIR);
  await createExperience(db, "u1", { title: "Staff Nurse", description: "Ward nursing" });
  await createSkill(db, "u1", { name: "Service Orientation", level: "strong" });
});

describe("generateCareerPaths", () => {
  it("grounds paths in taxonomy candidates and deterministic skill gaps", async () => {
    const main = new MockLanguageModelV4({
      doGenerate: jsonReply({
        paths: [
          path(
            "Specialist nurse",
            ["29-1141.00", "99-9999.00"],
            [
              { skill: "Medicine and Dentistry", note: "Deepen clinical knowledge" },
              { skill: "Astrology", note: "x" },
            ],
          ),
          path(
            "Health services manager",
            ["11-9111.00"],
            [{ skill: "critical thinking", note: "Take a management course" }],
          ),
          path("Invented", ["00-0000.00"], []),
        ],
      }),
    });
    const r = await generateCareerPaths(deps, llmWith(main), "u1", "health services");
    expect(r.paths.map((p) => [p.title, p.occupationCodes])).toEqual([
      ["Specialist nurse", ["29-1141.00"]],
      ["Health services manager", ["11-9111.00"]],
    ]);
    expect(r.paths[0]?.skillGaps).toEqual([
      {
        skill: "Medicine and Dentistry",
        taxonomySkillId: "onet:2.C.5.a",
        importance: 0.78,
        note: "Deepen clinical knowledge",
      },
    ]);
    expect(r.paths[1]?.skillGaps).toMatchObject([{ skill: "Critical Thinking", importance: 0.75 }]);
    const prompt = JSON.stringify(main.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("29-1141.00");
    expect(prompt).toContain("Medicine and Dentistry (0.78)");
    expect(prompt).not.toContain("Service Orientation (0.85)"); // the user already has it
  });
  it("fails when fewer than two grounded paths remain", async () => {
    const main = new MockLanguageModelV4({
      doGenerate: jsonReply({
        paths: [path("A", ["29-1141.00"], []), path("B", ["00-0000.00"], [])],
      }),
    });
    await expect(generateCareerPaths(deps, llmWith(main), "u1")).rejects.toBeInstanceOf(
      StructuredOutputError,
    );
  });
  it("returns a note without calling the model when nothing matches", async () => {
    await resetDb(db);
    await seedUser(db, "u1");
    pc = await seedProvider(db, "u1"); // empty taxonomy and profile
    const main = new MockLanguageModelV4({ doGenerate: jsonReply({ paths: [] }) });
    expect(await generateCareerPaths(deps, llmWith(main), "u1", "zzzz")).toEqual({
      paths: [],
      note: "I couldn't find matching occupations yet. Tell me more about your experience and interests.",
    });
    expect(main.doGenerateCalls).toHaveLength(0);
  });
});

it("getOccupation returns the lookup, and proposeSavePath creates a path_save proposal", async () => {
  const s = await getOrStartSession(db, "u1");
  const { id: messageId } = await appendMessage(db, "u1", s.id, {
    role: "assistant",
    parts: [],
    status: "interrupted",
  });
  const tools = getSkill("direction").tools({
    deps,
    llm: llmWith(new MockLanguageModelV4()),
    userId: "u1",
    sessionId: s.id,
    messageId,
    timezone: "UTC",
  });
  const rn = await runTool(tools, "getOccupation", { idOrCode: "29-1141.00" });
  expect(rn).toMatchObject({
    title: "Registered Nurses",
    source: "onet",
    code: "29-1141.00",
    altTitles: ["RN", "Staff Nurse"],
  });
  expect((rn as { related: { title: string }[] }).related.map((o) => o.title)).toEqual([
    "Medical and Health Services Managers",
  ]);
  await expect(runTool(tools, "getOccupation", { idOrCode: "nope" })).rejects.toThrow(
    "No occupation matches “nope”.",
  );
  await runTool(tools, "proposeSavePath", path("Registered Nurse", ["29-1141.00"], []));
  expect((await listProposals(db, "u1")).map((p) => p.kind)).toEqual(["path_save"]);
});
