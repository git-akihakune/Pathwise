import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { seedProvider, seedUser, workflowDeps } from "../../../../test/integration/fixtures";
import { schema } from "../db";
import { registerMockFixture } from "../llm";
import type { DocumentExtraction } from "../services/documents";
import { createPastedDocument, getDocument, parseDocument } from "../services/documents";
import { listMemory } from "../services/memory";
import { getProfile } from "../services/profile";
import { listConversation } from "../services/sessions";
import {
  advance,
  attachOnboardingDocument,
  DIRECTION_OPENER,
  getOnboardingState,
  INTAKE_OPENER,
  recordCompletedOnboarding,
  reviewInputFromExtraction,
  skipOnboarding,
  startWorkflow,
  stepMessages,
} from ".";

const db = getTestDb();
const deps = workflowDeps(db);
const text = (m: { parts: { type: string; text?: string }[] }) =>
  m.parts.map((p) => p.text ?? "").join("");
async function atIntake() {
  const run = await startWorkflow(deps, "u1", "onboarding");
  return advance(deps, "u1", run.id, { stepId: "ingest", skip: true });
}

beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  registerMockFixture("onboarding.snapshot", () => ({
    text: "Here's what I heard: you value autonomy.",
  }));
});

describe("onboarding", () => {
  it("waits at provider_check until a provider is connected", async () => {
    const run = await startWorkflow(deps, "u1", "onboarding");
    expect(run).toMatchObject({ stepId: "provider_check", status: "active" });
    await seedProvider(db, "u1");
    expect((await advance(deps, "u1", run.id)).stepId).toBe("ingest");
  });
  it("skipping the upload also skips review and opens the intake", async () => {
    await seedProvider(db, "u1");
    const r = await atIntake();
    expect(r.stepId).toBe("intake");
    expect(r.state.steps?.review_extraction?.status).toBe("skipped");
    expect((await stepMessages(db, "u1", r)).map(text)).toEqual([INTAKE_OPENER]);
  });
  it("starts with a document already attached", async () => {
    await seedProvider(db, "u1");
    const doc = await createPastedDocument(deps, "u1", {
      text: "Jane Doe, Staff Nurse at City Hospital since 2018, BSc Nursing.",
      kind: "cv",
    });
    const run = await startWorkflow(deps, "u1", "onboarding", { documentId: doc.id });
    expect(run).toMatchObject({ stepId: "ingest", state: { documentId: doc.id } });
  });
  it("moves to review once the document is parsed, and applies only what the user kept", async () => {
    await seedProvider(db, "u1");
    const run = await startWorkflow(deps, "u1", "onboarding");
    const doc = await createPastedDocument(deps, "u1", {
      text: "Jane Doe, Staff Nurse at City Hospital since 2018, BSc Nursing.",
      kind: "cv",
    });
    expect((await attachOnboardingDocument(deps, "u1", run.id, doc.id)).stepId).toBe("ingest");
    await parseDocument(deps, { userId: "u1", documentId: doc.id });
    const review = await advance(deps, "u1", run.id);
    expect(review.stepId).toBe("review_extraction");
    expect(
      reviewInputFromExtraction(review.state.extraction as DocumentExtraction).memories[0]?.keep,
    ).toBe(true);
    const r = await advance(deps, "u1", run.id, {
      stepId: "review_extraction",
      uiResult: {
        experiences: [
          {
            title: "Senior Staff Nurse",
            organization: "City Hospital",
            startDate: "2018-03",
            endDate: null,
            description: null,
            highlights: [],
          },
        ],
        education: [],
        skills: [{ name: "Patient care", level: "expert", evidence: null }],
        memories: [
          {
            category: "aspiration",
            content: "Wants to move into healthcare data work",
            sensitive: false,
            keep: false,
          },
        ],
        stories: [],
      },
    });
    expect(r.stepId).toBe("intake");
    const p = await getProfile(db, "u1");
    expect(p.experiences.map((e) => [e.title, e.sourceType, e.sourceId])).toEqual([
      ["Senior Staff Nurse", "cv", doc.id],
    ]);
    expect(p.education).toEqual([]);
    expect(p.skills.map((s) => s.name)).toEqual(["Patient care"]);
    expect(await listMemory(db, "u1")).toEqual([]);
  });
  it("rejects an impossible date or an over-long field in the review form", async () => {
    await seedProvider(db, "u1");
    const run = await startWorkflow(deps, "u1", "onboarding");
    const doc = await createPastedDocument(deps, "u1", {
      text: "Jane Doe, Staff Nurse at City Hospital since 2018, BSc Nursing.",
      kind: "cv",
    });
    await attachOnboardingDocument(deps, "u1", run.id, doc.id);
    await parseDocument(deps, { userId: "u1", documentId: doc.id });
    await advance(deps, "u1", run.id);
    const form = (exp: object) => ({
      experiences: [
        { organization: null, endDate: null, description: null, highlights: [], ...exp },
      ],
      education: [],
      skills: [],
      memories: [],
      stories: [],
    });
    const bad = (exp: object) =>
      advance(deps, "u1", run.id, {
        stepId: "review_extraction",
        uiResult: form({ title: "Nurse", startDate: "2018", ...exp }),
      });
    await expect(bad({ startDate: "2018-02-30" })).rejects.toThrow();
    await expect(bad({ title: "x".repeat(201) })).rejects.toThrow();
    expect((await getProfile(db, "u1")).experiences).toEqual([]);
  });
  it("gives up on a parse that never finishes (Review Focus 3)", async () => {
    await seedProvider(db, "u1");
    const run = await startWorkflow(deps, "u1", "onboarding");
    const doc = await createPastedDocument(deps, "u1", { text: "Jane Doe", kind: "cv" });
    await attachOnboardingDocument(deps, "u1", run.id, doc.id);
    await db
      .update(schema.documents)
      .set({ createdAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(schema.documents.id, doc.id));
    expect((await advance(deps, "u1", run.id)).stepId).toBe("ingest");
    expect(await getDocument(db, "u1", doc.id)).toMatchObject({
      status: "failed",
      error: "timed_out",
    });
  });
  it("a failed summary needs attention, and 'Do it manually' still reaches confirm", async () => {
    await seedProvider(db, "u1");
    registerMockFixture("onboarding.snapshot", () => {
      throw new Error("down");
    });
    const r = await atIntake();
    const stuck = await advance(deps, "u1", r.id, { stepId: "intake", skip: true });
    expect(stuck).toMatchObject({ stepId: "snapshot", status: "needs_attention" });
    const confirm = await advance(deps, "u1", r.id, { stepId: "snapshot", skip: true });
    expect(confirm.stepId).toBe("confirm");
    expect(confirm.state.heard).toBeUndefined();
  });
  it("confirm saves a correction and primes the direction conversation", async () => {
    await seedProvider(db, "u1");
    const r = await atIntake();
    const confirm = await advance(deps, "u1", r.id, { stepId: "intake", skip: true });
    expect(confirm.state.heard).toBe("Here's what I heard: you value autonomy.");
    const done = await advance(deps, "u1", r.id, {
      stepId: "confirm",
      uiResult: { correction: "I left nursing in May." },
    });
    expect(done.status).toBe("completed");
    expect(
      (await listMemory(db, "u1")).map((m) => [m.category, m.content, m.status, m.sourceType]),
    ).toEqual([["fact", "I left nursing in May.", "active", "manual"]]);
    const [latest] = (await listConversation(db, "u1", { limit: 1 })).slice(-1);
    expect(latest?.session.topic).toBe("Your direction");
    expect(latest?.messages.map(text)).toEqual([DIRECTION_OPENER]);
    expect(await getOnboardingState(db, "u1")).toBe("completed");
  });
  it("rejects a correction over 1000 characters and creates no memory", async () => {
    await seedProvider(db, "u1");
    const r = await atIntake();
    await advance(deps, "u1", r.id, { stepId: "intake", skip: true });
    await expect(
      advance(deps, "u1", r.id, { stepId: "confirm", uiResult: { correction: "x".repeat(1001) } }),
    ).rejects.toThrow();
    expect(await listMemory(db, "u1")).toEqual([]);
  });
  it("skipping after a completed onboarding changes nothing", async () => {
    await recordCompletedOnboarding(db, "u1");
    await skipOnboarding(deps, "u1");
    expect(await getOnboardingState(db, "u1")).toBe("completed");
  });
  it("reports skipped and lets the user start again", async () => {
    expect(await getOnboardingState(db, "u1")).toBe("not_started");
    await skipOnboarding(deps, "u1");
    expect(await getOnboardingState(db, "u1")).toBe("skipped");
    await startWorkflow(deps, "u1", "onboarding");
    expect(await getOnboardingState(db, "u1")).toBe("in_progress");
  });
  it("records a completed onboarding once, for seeded users", async () => {
    await recordCompletedOnboarding(db, "u1");
    await recordCompletedOnboarding(db, "u1");
    expect(await getOnboardingState(db, "u1")).toBe("completed");
    expect(await db.$count(schema.workflowRuns)).toBe(1);
  });
});
