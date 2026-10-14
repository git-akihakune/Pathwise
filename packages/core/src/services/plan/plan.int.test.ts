import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { PATH } from "../../../../../test/fixtures/paths";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { seedUser } from "../../../../../test/integration/fixtures";
import { schema } from "../../db";
import { ConflictError, NotFoundError } from "../../errors";
import { deletePath, listPaths, savePath, setPathStatus } from "../paths";
import {
  actionsForWeek,
  addAction,
  addMilestone,
  createPlan,
  getActivePlan,
  removeAction,
  removeMilestone,
  setActionStatus,
  updateAction,
  updateMilestone,
  updatePlan,
} from ".";

const db = getTestDb();
const empty = (northStar: string) => ({ northStar, milestones: [], actions: [] });

beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  await seedUser(db, "u2");
});

describe("paths", () => {
  it("validates, saves as explored, and isolates", async () => {
    await expect(
      savePath(db, "u1", {
        ...PATH,
        feasibility: { ...PATH.feasibility, timeMonths: { min: 9, max: 3 } },
      }),
    ).rejects.toBeInstanceOf(ZodError);
    const p = await savePath(db, "u1", PATH);
    expect(p).toMatchObject({ status: "explored", version: 1, route: PATH.route });
    await expect(deletePath(db, "u2", p.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listPaths(db, "u2")).toEqual([]);
  });

  it("filters by status, lists newest first, and sets status", async () => {
    const a = await savePath(db, "u1", PATH);
    const b = await savePath(db, "u1", { ...PATH, title: "Second" });
    expect((await listPaths(db, "u1")).map((p) => p.id)).toEqual([b.id, a.id]);
    const dismissed = await setPathStatus(db, "u1", a.id, "dismissed");
    expect(dismissed).toMatchObject({ status: "dismissed", version: 2, title: "Data analyst" });
    expect((await listPaths(db, "u1", { status: ["explored"] })).map((p) => p.id)).toEqual([b.id]);
    await expect(setPathStatus(db, "u2", a.id, "chosen")).rejects.toBeInstanceOf(NotFoundError);
    await deletePath(db, "u1", a.id);
    expect(await listPaths(db, "u1")).toHaveLength(1);
  });
});

describe("plans", () => {
  it("creates a plan with milestones and actions and marks the path chosen", async () => {
    const path = await savePath(db, "u1", PATH);
    const plan = await createPlan(db, "u1", {
      northStar: "Data analyst by 2027",
      careerPathId: path.id,
      milestones: [{ title: "SQL" }, { title: "Portfolio", targetDate: "2027-03-31" }],
      actions: [
        { title: "5 exercises", weekOf: "2026-10-12", milestoneIndex: 0 },
        { title: "Pick a dataset", weekOf: "2026-10-19" },
      ],
    });
    expect(plan.milestones.map((m) => [m.title, m.position, m.status])).toEqual([
      ["SQL", 0, "open"],
      ["Portfolio", 1, "open"],
    ]);
    expect(plan.actions[0]).toMatchObject({
      title: "5 exercises",
      milestoneId: plan.milestones[0]?.id,
      status: "todo",
      doneAt: null,
    });
    expect((await listPaths(db, "u1"))[0]?.status).toBe("chosen");
    expect((await actionsForWeek(db, "u1", "2026-10-19")).map((a) => a.title)).toEqual([
      "Pick a dataset",
    ]);
  });

  it("rejects a foreign path and an unknown milestone index", async () => {
    const other = await savePath(db, "u2", PATH);
    await expect(
      createPlan(db, "u1", { ...empty("A"), careerPathId: other.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createPlan(db, "u1", {
        ...empty("A"),
        actions: [{ title: "x", weekOf: "2026-10-12", milestoneIndex: 0 }],
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await getActivePlan(db, "u1")).toBeNull();
  });

  it("returns actions in a stable order within a week", async () => {
    const titles = ["a", "b", "c", "d", "e"];
    const plan = await createPlan(db, "u1", {
      ...empty("A"),
      actions: titles.map((title) => ({ title, weekOf: "2026-10-12" })),
    });
    expect(plan.actions.map((a) => a.title)).toEqual(titles);
    expect((await actionsForWeek(db, "u1", "2026-10-12")).map((a) => a.title)).toEqual(titles);
  });

  it("archives the previous plan, and concurrent creates leave one active plan (Review Focus 4)", async () => {
    await createPlan(db, "u1", empty("A"));
    await Promise.all([createPlan(db, "u1", empty("B")), createPlan(db, "u1", empty("C"))]);
    const rows = await db.select().from(schema.plans).where(eq(schema.plans.userId, "u1"));
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
    expect(["B", "C"]).toContain((await getActivePlan(db, "u1"))?.northStar);
  });

  it("bumps plans.version on structural edits only", async () => {
    const plan = await createPlan(db, "u1", {
      ...empty("A"),
      actions: [{ title: "x", weekOf: "2026-10-12" }],
    });
    const actionId = plan.actions[0]?.id ?? "";
    const m = await addMilestone(db, "u1", plan.id, { title: "M" });
    await updateAction(db, "u1", actionId, { milestoneId: m.id });
    const done = await setActionStatus(db, "u1", actionId, "done");
    expect(done).toMatchObject({ status: "done", version: 3, doneAt: expect.any(Date) });
    expect((await getActivePlan(db, "u1"))?.version).toBe(3);
    await expect(setActionStatus(db, "u1", actionId, "todo", 1)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await setActionStatus(db, "u1", actionId, "todo", 3)).doneAt).toBeNull();
    await removeMilestone(db, "u1", m.id);
    expect((await getActivePlan(db, "u1"))?.actions[0]?.milestoneId).toBeNull();
  });

  it("rejects non-Monday weeks, stale edits, archived plans, and other users", async () => {
    const a = await createPlan(db, "u1", empty("A"));
    await expect(
      addAction(db, "u1", a.id, { title: "x", weekOf: "2026-10-13" }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(updatePlan(db, "u1", a.id, { northStar: "B" }, 7)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(addMilestone(db, "u2", a.id, { title: "M" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await createPlan(db, "u1", empty("Next"));
    await expect(addMilestone(db, "u1", a.id, { title: "M" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("patching one field leaves the others unchanged", async () => {
    const plan = await createPlan(db, "u1", {
      northStar: "A",
      milestones: [{ title: "M", description: "d", targetDate: "2027-01-01" }],
      actions: [{ title: "x", notes: "n", weekOf: "2026-10-12", milestoneIndex: 0 }],
    });
    const m = plan.milestones[0];
    const act = plan.actions[0];
    expect(await updateMilestone(db, "u1", m?.id ?? "", { title: "M2" })).toMatchObject({
      title: "M2",
      description: "d",
      targetDate: "2027-01-01",
      status: "open",
      position: 0,
    });
    expect(await updateAction(db, "u1", act?.id ?? "", { title: "x2" })).toMatchObject({
      title: "x2",
      notes: "n",
      weekOf: "2026-10-12",
      milestoneId: m?.id,
    });
    expect(await updatePlan(db, "u1", plan.id, {})).toMatchObject({
      northStar: "A",
      milestones: [expect.objectContaining({ title: "M2" })],
    });
  });

  it("scopes milestone and action edits to the owner and the plan", async () => {
    const a = await createPlan(db, "u1", {
      ...empty("A"),
      milestones: [{ title: "M" }],
      actions: [{ title: "x", weekOf: "2026-10-12" }],
    });
    const b = await createPlan(db, "u2", { ...empty("B"), milestones: [{ title: "N" }] });
    const [m, act] = [a.milestones[0]?.id ?? "", a.actions[0]?.id ?? ""];
    await expect(updateMilestone(db, "u2", m, { title: "Z" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(removeAction(db, "u2", act)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setActionStatus(db, "u2", act, "done")).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateAction(db, "u1", act, { milestoneId: b.milestones[0]?.id ?? "" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await removeAction(db, "u1", act);
    expect((await getActivePlan(db, "u1"))?.actions).toEqual([]);
  });
});

describe("impossible calendar dates", () => {
  it("rejects them with a validation error instead of a database error", async () => {
    await expect(
      createPlan(db, "u1", {
        ...empty("N"),
        milestones: [{ title: "M", targetDate: "2026-02-30" }],
      }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      createPlan(db, "u1", { ...empty("N"), actions: [{ title: "A", weekOf: "2026-02-30" }] }),
    ).rejects.toBeInstanceOf(ZodError);
  });
});
