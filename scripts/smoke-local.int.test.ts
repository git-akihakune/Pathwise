import { beforeEach, expect, it } from "vitest";
import { registerMockFixture } from "../packages/core/src/llm";
import { probeFixture } from "../packages/core/src/llm/mock/fixtures/probe";
import { getProfile } from "../packages/core/src/services/profile";
import { getRun } from "../packages/core/src/workflows";
import { getTestDb, resetDb } from "../test/integration/db";
import { workflowDeps } from "../test/integration/fixtures";
import { runSmokeScenario } from "./smoke-local";

const db = getTestDb();
const deps = workflowDeps(db);
const env = { baseUrl: "http://localhost:8080/v1", model: "local-model", apiKey: undefined };
const extraction = {
  experiences: [
    {
      title: "Warehouse Team Lead",
      organization: "Northside Logistics",
      startDate: "2019",
      endDate: "present",
      description: null,
      highlights: ["Cut picking errors by 20%"],
    },
  ],
  education: [],
  skills: [{ name: "Shift scheduling", level: "working", evidence: null }],
  memories: [],
  stories: [],
};

beforeEach(async () => {
  await resetDb(db);
  deps.queue.sent.length = 0;
  registerMockFixture("probe", probeFixture);
  registerMockFixture("extract.document", () => ({ json: extraction }));
  registerMockFixture("onboarding.snapshot", () => ({
    text: "You want more time solving data problems.",
  }));
});

it.each([true, false])(
  "completes onboarding with completion check done=%s and saves reviewed experience",
  async (done) => {
    registerMockFixture("workflow.complete", () => ({ json: { done, reason: "mock" } }));
    const lines: string[] = [];
    const result = await runSmokeScenario(deps, env, (line) => lines.push(line));
    expect(result).toMatchObject({ providerStatus: "full", experiences: 1, skills: 1 });
    expect(result.intakeReplyLength).toBeGreaterThan(0);
    expect(await getRun(db, result.userId, result.runId)).toMatchObject({ status: "completed" });
    expect((await getProfile(db, result.userId)).experiences).toMatchObject([
      { title: "Warehouse Team Lead", organization: "Northside Logistics", sourceType: "cv" },
    ]);
    expect(lines.join("\n")).toContain("✔ Onboarding");
    expect(lines.join("\n")).toContain("Provider: full");
  },
);

it("accepts degraded capabilities and completes through prompted JSON fallbacks", async () => {
  registerMockFixture("probe", (call) =>
    call.toolNames.includes("echo") || call.lastUserText.includes("city Paris")
      ? { text: "No native capability" }
      : probeFixture(call),
  );
  registerMockFixture("workflow.complete", () => ({ json: { done: false, reason: "mock" } }));
  const lines: string[] = [];
  expect((await runSmokeScenario(deps, env, (line) => lines.push(line))).providerStatus).toBe(
    "degraded",
  );
  expect(lines.join("\n")).toContain("degraded (acceptable)");
});

it("rejects an unsupported provider before parsing or onboarding and redacts its key", async () => {
  registerMockFixture("probe", () => {
    throw new Error("Rejected secret-smoke-key");
  });
  const lines: string[] = [];
  await expect(
    runSmokeScenario(deps, { ...env, apiKey: "secret-smoke-key" }, (line) => lines.push(line)),
  ).rejects.toThrow("unsupported");
  expect(deps.queue.sent).toEqual([]);
  expect(lines.join("\n")).toContain("✘ Capability probe");
  expect(lines.join("\n")).not.toContain("secret-smoke-key");
});

it("fails when parsing extracts no experience", async () => {
  registerMockFixture("extract.document", () => ({ json: { ...extraction, experiences: [] } }));
  await expect(runSmokeScenario(deps, env, () => {})).rejects.toThrow("No experience extracted");
});

it("fails when the workflow needs attention instead of declaring success", async () => {
  registerMockFixture("workflow.complete", () => ({ json: { done: false, reason: "mock" } }));
  registerMockFixture("onboarding.snapshot", () => {
    throw new Error("offline");
  });
  await expect(runSmokeScenario(deps, env, () => {})).rejects.toThrow("needs_attention");
});
