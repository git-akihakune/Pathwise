import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { seedProvider, seedUser, workflowDeps } from "../../../../test/integration/fixtures";
import { ConflictError } from "../errors";
import { registerMockFixture } from "../llm";
import { createWorkflowEngine } from "./engine";
import type { WorkflowDefinition } from "./types";

const db = getTestDb();
const deps = workflowDeps(db);
let deterministic = false;
const toy: WorkflowDefinition = {
  type: "checkin",
  steps: [
    {
      kind: "conversational",
      id: "talk",
      skills: [],
      goal: "Hear one win.",
      opener: "What went well this week?",
      isComplete: () => deterministic,
    },
    { kind: "ui", id: "after", input: z.object({}) },
  ],
};
const engine = createWorkflowEngine({ checkin: toy });
const say = (text: string, id: string = crypto.randomUUID()): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});
const texts = (ms: UIMessage[]) =>
  ms.map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""));
const turn = async (runId: string, text: string, userId = "u1") =>
  (await engine.runWorkflowTurn(deps, { userId, runId, message: say(text) })).text();

beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  await seedProvider(db, "u1");
  deterministic = false;
  registerMockFixture("workflow.complete", (c) => ({
    json: { done: /that's all/i.test(c.lastUserText), reason: "mock" },
  }));
});

describe("conversational steps", () => {
  it("posts the opener once, as the first message of the step", async () => {
    const run = await engine.startWorkflow(deps, "u1", "checkin");
    await engine.advance(deps, "u1", run.id);
    await engine.startWorkflow(deps, "u1", "checkin");
    const current = await engine.getRun(db, "u1", run.id);
    expect(texts(await engine.stepMessages(db, "u1", current))).toEqual([
      "What went well this week?",
    ]);
  });

  it("records a not-done check and stays on the step", async () => {
    const run = await engine.startWorkflow(deps, "u1", "checkin");
    await turn(run.id, "Hmm, let me think");
    const r = await engine.getRun(db, "u1", run.id);
    expect(r.stepId).toBe("talk");
    expect(r.state.steps?.talk?.check).toEqual({ done: false, reason: "mock" });
    expect(texts(await engine.stepMessages(db, "u1", r))).toHaveLength(3);
  });

  it("advances when the completion check says done", async () => {
    const run = await engine.startWorkflow(deps, "u1", "checkin");
    await turn(run.id, "I shipped the portfolio. That's all.");
    const r = await engine.getRun(db, "u1", run.id);
    expect(r.stepId).toBe("after");
    expect(r.state.steps?.talk).toMatchObject({ status: "done", check: { done: true } });
  });

  it("advances on the deterministic hook without asking the model", async () => {
    registerMockFixture("workflow.complete", () => {
      throw new Error("must not be called");
    });
    deterministic = true;
    const run = await engine.startWorkflow(deps, "u1", "checkin");
    await turn(run.id, "Hello");
    expect(await engine.getRun(db, "u1", run.id)).toMatchObject({ stepId: "after" });
  });

  it("a failing check never blocks the user", async () => {
    registerMockFixture("workflow.complete", () => {
      throw new Error("provider down");
    });
    const run = await engine.startWorkflow(deps, "u1", "checkin");
    await turn(run.id, "That's all.");
    expect(await engine.getRun(db, "u1", run.id)).toMatchObject({
      stepId: "talk",
      status: "active",
    });
  });

  it("rejects chat turns once the run has left the conversational step", async () => {
    const run = await engine.startWorkflow(deps, "u1", "checkin");
    await engine.advance(deps, "u1", run.id, { stepId: "talk", skip: true });
    await expect(
      engine.runWorkflowTurn(deps, { userId: "u1", runId: run.id, message: say("hi") }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("answers a crisis message with the safety response, without a provider, and stays put", async () => {
    await seedUser(db, "u2");
    const run = await engine.startWorkflow(deps, "u2", "checkin");
    const body = await turn(run.id, "I can't go on. That's all.", "u2");
    expect(body).toContain("findahelpline");
    expect(await engine.getRun(db, "u2", run.id)).toMatchObject({ stepId: "talk" });
    expect((await engine.getRun(db, "u2", run.id)).state.steps?.talk?.check).toBeUndefined();
  });

  it("rejects a regenerate of a message from another session", async () => {
    const run = await engine.startWorkflow(deps, "u1", "checkin");
    const free = say("hello from free chat");
    const { runTurn } = await import("../agent/turn");
    await (await runTurn(deps, { userId: "u1", message: free })).text();
    await expect(
      engine.runWorkflowTurn(deps, { userId: "u1", runId: run.id, message: free }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("gives the coach the goal and opener, and drops the goal under elevated distress", async () => {
    const systems: string[] = [];
    registerMockFixture("chat", (c) => {
      systems.push(c.system);
      return { text: "Thanks for sharing that." };
    });
    const run = await engine.startWorkflow(deps, "u1", "checkin");
    await turn(run.id, "Work was fine");
    await turn(run.id, "I feel overwhelmed");
    expect(systems[0]).toContain("Hear one win.");
    expect(systems[0]).toContain("What went well this week?");
    expect(systems[1]).not.toContain("Hear one win.");
  });
});
