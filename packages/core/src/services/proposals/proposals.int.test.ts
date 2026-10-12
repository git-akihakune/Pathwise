import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { PATH } from "../../../../../test/fixtures/paths";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { seedUser } from "../../../../../test/integration/fixtures";
import { ConflictError, NotFoundError } from "../../errors";
import { addMemory, listMemory } from "../memory";
import { listPaths } from "../paths";
import { addMilestone, createPlan, getActivePlan, setActionStatus } from "../plan";
import { createExperience, deleteExperience, getProfile, updateExperience } from "../profile";
import { createStory, listStories } from "../stories";
import { approveProposal, createProposal, getProposal, listProposals, rejectProposal } from ".";

const db = getTestDb();
const STORY = {
  title: "Shipped v2",
  situation: "s",
  task: "t",
  action: "a",
  result: "r",
  metrics: null,
  skills: ["Go"],
};
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  await seedUser(db, "u2");
});

describe("approving applies each kind", () => {
  it("profile_update create, update, delete", async () => {
    const c = await createProposal(db, "u1", {
      kind: "profile_update",
      payload: { entity: "experience", op: "create", fields: { title: "Analyst" } },
    });
    expect(c).toMatchObject({ status: "pending", targetId: null, targetVersion: null });
    expect(await approveProposal(db, "u1", c.id)).toEqual({ status: "approved" });
    const [exp] = (await getProfile(db, "u1")).experiences;
    expect(exp).toMatchObject({ title: "Analyst", sourceType: "message" });
    const u = await createProposal(db, "u1", {
      kind: "profile_update",
      payload: { entity: "experience", op: "update", id: exp?.id, fields: { title: "Lead" } },
    });
    expect(u).toMatchObject({ targetId: exp?.id, targetVersion: 1 });
    await approveProposal(db, "u1", u.id);
    const d = await createProposal(db, "u1", {
      kind: "profile_update",
      payload: { entity: "experience", op: "delete", id: exp?.id },
    });
    expect(d.targetVersion).toBe(2);
    await approveProposal(db, "u1", d.id);
    expect((await getProfile(db, "u1")).experiences).toEqual([]);
  });
  it("memory_add is always active, even when sensitive", async () => {
    const p = await createProposal(db, "u1", {
      kind: "memory_add",
      messageId: "5b8e2f4a-9c1d-4e7b-8a3f-2d6c0b1e9f47",
      payload: { category: "constraint", content: "Needs visa sponsorship", sensitive: true },
    });
    await approveProposal(db, "u1", p.id);
    expect((await listMemory(db, "u1"))[0]).toMatchObject({
      status: "active",
      sensitive: true,
      sourceType: "message",
      sourceId: "5b8e2f4a-9c1d-4e7b-8a3f-2d6c0b1e9f47",
      confidence: 1,
    });
    expect(await getProposal(db, "u1", p.id)).toMatchObject({
      status: "approved",
      resolvedAt: expect.any(Date),
    });
  });
  it("story_add, path_save, and plan_create", async () => {
    for (const input of [
      { kind: "story_add", payload: STORY },
      { kind: "path_save", payload: PATH },
    ] as const) {
      await approveProposal(db, "u1", (await createProposal(db, "u1", input)).id);
    }
    const [path] = await listPaths(db, "u1");
    const p = await createProposal(db, "u1", {
      kind: "plan_create",
      payload: {
        northStar: "N",
        careerPathId: path?.id,
        milestones: [{ title: "M" }],
        actions: [{ title: "A", weekOf: "2026-10-12", milestoneIndex: 0 }],
      },
    });
    await approveProposal(db, "u1", p.id);
    expect((await listStories(db, "u1")).map((s) => s.title)).toEqual(["Shipped v2"]);
    expect((await getActivePlan(db, "u1"))?.actions[0]?.title).toBe("A");
    expect((await listPaths(db, "u1"))[0]?.status).toBe("chosen");
  });
  it("plan_change and action_status_update", async () => {
    const plan = await createPlan(db, "u1", {
      northStar: "N",
      milestones: [{ title: "Old" }],
      actions: [{ title: "A", weekOf: "2026-10-12" }],
    });
    const [old] = plan.milestones;
    const [act] = plan.actions;
    const c = await createProposal(db, "u1", {
      kind: "plan_change",
      payload: {
        northStar: "N2",
        milestones: { add: [{ title: "New" }], update: [], remove: [old?.id ?? ""] },
        actions: {
          add: [{ title: "B", weekOf: "2026-10-19" }],
          update: [{ id: act?.id ?? "", title: "A2" }],
          remove: [],
        },
      },
    });
    expect(c).toMatchObject({ targetId: plan.id, targetVersion: 1 });
    await approveProposal(db, "u1", c.id);
    const after = await getActivePlan(db, "u1");
    expect([
      after?.northStar,
      after?.milestones.map((m) => m.title),
      after?.actions.map((a) => a.title),
    ]).toEqual(["N2", ["New"], ["A2", "B"]]);
    const s = await createProposal(db, "u1", {
      kind: "action_status_update",
      payload: { updates: [{ actionId: act?.id ?? "", status: "done", basedOnVersion: 2 }] },
    });
    await approveProposal(db, "u1", s.id);
    expect((await getActivePlan(db, "u1"))?.actions[0]?.status).toBe("done");
  });
});

describe("staleness and safety", () => {
  it("conflicts when the target changed after the proposal was made (Review Focus 1)", async () => {
    const exp = await createExperience(db, "u1", { title: "Analyst" });
    const p = await createProposal(db, "u1", {
      kind: "profile_update",
      payload: {
        entity: "experience",
        op: "update",
        id: exp.id,
        fields: { title: "Senior Analyst" },
      },
    });
    await updateExperience(db, "u1", exp.id, { organization: "Acme" });
    expect(await approveProposal(db, "u1", p.id)).toEqual({ status: "conflicted" });
    expect((await getProfile(db, "u1")).experiences[0]).toMatchObject({
      title: "Analyst",
      organization: "Acme",
      version: 2,
    });
    expect((await getProposal(db, "u1", p.id)).status).toBe("conflicted");
  });
  it("conflicts when the target was deleted, a different plan became active, or one action is stale", async () => {
    const exp = await createExperience(db, "u1", { title: "Gone" });
    const del = await createProposal(db, "u1", {
      kind: "profile_update",
      payload: { entity: "experience", op: "update", id: exp.id, fields: { title: "X" } },
    });
    await deleteExperience(db, "u1", exp.id);
    expect(await approveProposal(db, "u1", del.id)).toEqual({ status: "conflicted" });

    const pc = await createProposal(db, "u1", {
      kind: "plan_create",
      payload: { northStar: "Coach's", milestones: [], actions: [] },
    });
    const manual = await createPlan(db, "u1", {
      northStar: "Mine",
      milestones: [],
      actions: [
        { title: "A", weekOf: "2026-10-12" },
        { title: "B", weekOf: "2026-10-12" },
      ],
    });
    expect(await approveProposal(db, "u1", pc.id)).toEqual({ status: "conflicted" });
    expect((await getActivePlan(db, "u1"))?.northStar).toBe("Mine");

    const [a, b] = manual.actions;
    const st = await createProposal(db, "u1", {
      kind: "action_status_update",
      payload: {
        updates: [
          { actionId: a?.id ?? "", status: "done", basedOnVersion: 1 },
          { actionId: b?.id ?? "", status: "done", basedOnVersion: 1 },
        ],
      },
    });
    await setActionStatus(db, "u1", b?.id ?? "", "skipped");
    expect(await approveProposal(db, "u1", st.id)).toEqual({ status: "conflicted" });
    expect((await getActivePlan(db, "u1"))?.actions.map((x) => x.status)).toEqual([
      "todo",
      "skipped",
    ]);
  });
  it("re-validates edited payloads and refuses retargeting", async () => {
    const p = await createProposal(db, "u1", {
      kind: "memory_add",
      payload: { category: "value", content: "Autonmy", sensitive: false },
    });
    await expect(
      approveProposal(db, "u1", p.id, {
        editedPayload: { category: "value", content: "", sensitive: false },
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect((await getProposal(db, "u1", p.id)).status).toBe("pending");
    await approveProposal(db, "u1", p.id, {
      editedPayload: { category: "value", content: "Autonomy", sensitive: false },
    });
    expect((await listMemory(db, "u1"))[0]?.content).toBe("Autonomy");
    const [e1, e2] = [
      await createExperience(db, "u1", { title: "A" }),
      await createExperience(db, "u1", { title: "B" }),
    ];
    const u = await createProposal(db, "u1", {
      kind: "profile_update",
      payload: { entity: "experience", op: "update", id: e1.id, fields: { title: "A2" } },
    });
    await expect(
      approveProposal(db, "u1", u.id, {
        editedPayload: { entity: "experience", op: "update", id: e2.id, fields: { title: "A2" } },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
  it("applies once when approved twice at the same time (Review Focus 5)", async () => {
    const p = await createProposal(db, "u1", {
      kind: "memory_add",
      payload: { category: "value", content: "Autonomy", sensitive: false },
    });
    const results = await Promise.allSettled([
      approveProposal(db, "u1", p.id),
      approveProposal(db, "u1", p.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")?.reason).toBeInstanceOf(ConflictError);
    expect(await listMemory(db, "u1")).toHaveLength(1);
    await expect(rejectProposal(db, "u1", p.id)).rejects.toBeInstanceOf(ConflictError);
  });
  it("rejects, lists, and keeps proposals private", async () => {
    const p = await createProposal(db, "u1", {
      kind: "story_add",
      payload: STORY,
      sessionId: "0c4d7a1e-6b2f-4c8a-9e3d-5f1a2b7c8d90",
    });
    await expect(getProposal(db, "u2", p.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(approveProposal(db, "u2", p.id)).rejects.toBeInstanceOf(NotFoundError);
    const theirs = await createExperience(db, "u2", { title: "Theirs" });
    await expect(
      createProposal(db, "u1", {
        kind: "profile_update",
        payload: { entity: "experience", op: "delete", id: theirs.id },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      (await listProposals(db, "u1", { sessionId: "0c4d7a1e-6b2f-4c8a-9e3d-5f1a2b7c8d90" })).map(
        (x) => x.id,
      ),
    ).toEqual([p.id]);
    await rejectProposal(db, "u1", p.id);
    expect(await listProposals(db, "u1", { status: ["pending"] })).toEqual([]);
    expect(await listStories(db, "u1")).toEqual([]);
  });
});

describe("targeted kinds beyond profile", () => {
  it("applies memory_update and story_update, and conflicts a stale plan_change", async () => {
    const mem = await addMemory(db, "u1", {
      category: "value",
      content: "Old",
      sourceType: "manual",
      sourceId: null,
      confidence: 1,
      sensitive: false,
      status: "active",
    });
    const story = await createStory(db, "u1", { title: "S", result: "keep" });
    const mu = await createProposal(db, "u1", {
      kind: "memory_update",
      payload: { id: mem.id, content: "New" },
    });
    const su = await createProposal(db, "u1", {
      kind: "story_update",
      payload: { id: story.id, fields: { title: "S2" } },
    });
    expect(await approveProposal(db, "u1", mu.id)).toEqual({ status: "approved" });
    expect(await approveProposal(db, "u1", su.id)).toEqual({ status: "approved" });
    expect((await listMemory(db, "u1"))[0]).toMatchObject({ content: "New", category: "value" });
    expect((await listStories(db, "u1"))[0]).toMatchObject({ title: "S2", result: "keep" });

    const plan = await createPlan(db, "u1", { northStar: "N", milestones: [], actions: [] });
    const pc = await createProposal(db, "u1", {
      kind: "plan_change",
      payload: {
        northStar: "N2",
        milestones: { add: [], update: [], remove: [] },
        actions: { add: [], update: [], remove: [] },
      },
    });
    await addMilestone(db, "u1", plan.id, { title: "Manual" });
    expect(await approveProposal(db, "u1", pc.id)).toEqual({ status: "conflicted" });
    expect((await getActivePlan(db, "u1"))?.northStar).toBe("N");
  });
});

describe("plan_change locks the plan before comparing", () => {
  it("waits for an in-flight manual edit, then conflicts (no northStar)", async () => {
    const plan = await createPlan(db, "u1", { northStar: "N", milestones: [], actions: [] });
    const pc = await createProposal(db, "u1", {
      kind: "plan_change",
      payload: {
        milestones: { add: [{ title: "Coach" }], update: [], remove: [] },
        actions: { add: [], update: [], remove: [] },
      },
    });
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let inside = () => {};
    const entered = new Promise<void>((r) => {
      inside = r;
    });
    const manual = db.transaction(async (tx) => {
      await addMilestone(tx, "u1", plan.id, { title: "Manual" });
      inside();
      await gate;
    });
    await entered;
    const approving = approveProposal(db, "u1", pc.id);
    await new Promise((r) => setTimeout(r, 200));
    release();
    await manual;
    expect(await approving).toEqual({ status: "conflicted" });
    expect((await getActivePlan(db, "u1"))?.milestones.map((m) => m.title)).toEqual(["Manual"]);
  });
});

describe("final review fixes", () => {
  const memInput = (over = {}) => ({
    category: "value" as const,
    content: "Old",
    sourceType: "manual" as const,
    sourceId: null,
    confidence: 1,
    sensitive: false,
    status: "active" as const,
    ...over,
  });

  it("plan_create waits for a concurrent manual createPlan and then conflicts", async () => {
    const proposal = await createProposal(db, "u1", {
      kind: "plan_create",
      payload: { northStar: "Proposed", milestones: [], actions: [] },
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let created: () => void = () => {};
    const manualCreated = new Promise<void>((r) => {
      created = r;
    });
    const manual = db.transaction(async (tx) => {
      await createPlan(tx, "u1", { northStar: "Manual", milestones: [], actions: [] });
      created();
      await gate;
    });
    await manualCreated;
    const approval = approveProposal(db, "u1", proposal.id);
    await new Promise((r) => setTimeout(r, 300));
    release();
    await manual;
    expect(await approval).toEqual({ status: "conflicted" });
    expect((await getActivePlan(db, "u1"))?.northStar).toBe("Manual");
  });

  it("an edit cannot refresh an action's basedOnVersion to bypass staleness", async () => {
    const plan = await createPlan(db, "u1", {
      northStar: "N",
      milestones: [],
      actions: [{ title: "A", weekOf: "2026-10-12" }],
    });
    const act = plan.actions[0];
    const p = await createProposal(db, "u1", {
      kind: "action_status_update",
      payload: { updates: [{ actionId: act?.id ?? "", status: "done", basedOnVersion: 1 }] },
    });
    await setActionStatus(db, "u1", act?.id ?? "", "skipped", 1);
    const result = await approveProposal(db, "u1", p.id, {
      editedPayload: {
        updates: [{ actionId: act?.id ?? "", status: "done", basedOnVersion: 2 }],
      },
    });
    expect(result).toEqual({ status: "conflicted" });
    expect((await getActivePlan(db, "u1"))?.actions[0]?.status).toBe("skipped");
  });

  it("rejects memory_update on a superseded or rejected item", async () => {
    const old = await addMemory(db, "u1", memInput());
    await addMemory(db, "u1", memInput({ content: "New", supersedesId: old.id }));
    await expect(
      createProposal(db, "u1", { kind: "memory_update", payload: { id: old.id, content: "X" } }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("approving memory_update on a pending item activates it", async () => {
    const pending = await addMemory(db, "u1", memInput({ status: "pending" }));
    const p = await createProposal(db, "u1", {
      kind: "memory_update",
      payload: { id: pending.id, content: "Confirmed" },
    });
    await approveProposal(db, "u1", p.id);
    expect(await listMemory(db, "u1")).toMatchObject([{ content: "Confirmed", status: "active" }]);
  });
});
