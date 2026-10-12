"use server";

import { setPathStatus } from "@pathwise/core/services/paths";
import {
  addAction,
  addMilestone,
  createPlan,
  removeAction,
  removeMilestone,
  setActionStatus,
  updateAction,
  updateMilestone,
  updatePlan,
  weekStartOf,
} from "@pathwise/core/services/plan";
import { type FormState, field, removeEntity, runForm } from "@/lib/entity-action";
import { getServer } from "@/lib/server";

const PATH = "/plan";
const version = (fd: FormData) => {
  const v = field(fd, "version");
  return v === null ? undefined : Number(v);
};
const idOf = (fd: FormData) => field(fd, "id") ?? "";

/** Snaps a "Week of" date to its Monday; anything unparseable is left for core to reject. */
function normalizeWeek(s: string | null): string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    return s ?? "";
  }
  return weekStartOf(s);
}

const milestoneValues = (fd: FormData) => ({
  title: field(fd, "title") ?? "",
  description: field(fd, "description"),
  targetDate: field(fd, "targetDate"),
});

const actionValues = (fd: FormData) => ({
  title: field(fd, "title") ?? "",
  notes: field(fd, "notes"),
  weekOf: normalizeWeek(field(fd, "weekOf")),
  milestoneId: field(fd, "milestoneId"),
});

export async function createPlanAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db } = getServer();
  return runForm(PATH, (userId) =>
    createPlan(db, userId, {
      northStar: field(fd, "northStar") ?? "",
      careerPathId: field(fd, "careerPathId") ?? undefined,
      milestones: [],
      actions: [],
    }),
  );
}

export async function updateNorthStarAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db } = getServer();
  return runForm(PATH, (userId) =>
    updatePlan(db, userId, idOf(fd), { northStar: field(fd, "northStar") ?? "" }, version(fd)),
  );
}

export async function addMilestoneAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db } = getServer();
  return runForm(PATH, (userId) =>
    addMilestone(db, userId, field(fd, "planId") ?? "", milestoneValues(fd)),
  );
}

/** Edits a milestone's fields; the status select posts only `status`, so only posted fields change. */
export async function updateMilestoneAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db } = getServer();
  const status = field(fd, "status");
  const patch = fd.has("title")
    ? milestoneValues(fd)
    : { status: status as "open" | "done" | "dropped" };
  return runForm(PATH, (userId) => updateMilestone(db, userId, idOf(fd), patch, version(fd)));
}

export async function removeMilestoneAction(fd: FormData): Promise<void> {
  const { db } = getServer();
  await removeEntity(PATH, fd, (userId, id) => removeMilestone(db, userId, id));
}

export async function addActionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db } = getServer();
  return runForm(PATH, (userId) =>
    addAction(db, userId, field(fd, "planId") ?? "", actionValues(fd)),
  );
}

export async function updateActionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db } = getServer();
  return runForm(PATH, (userId) =>
    updateAction(db, userId, idOf(fd), actionValues(fd), version(fd)),
  );
}

export async function removeActionAction(fd: FormData): Promise<void> {
  const { db } = getServer();
  await removeEntity(PATH, fd, (userId, id) => removeAction(db, userId, id));
}

export async function setActionStatusAction(
  id: string,
  status: "todo" | "done" | "skipped",
  version: number,
): Promise<FormState> {
  const { db } = getServer();
  return runForm(PATH, (userId) => setActionStatus(db, userId, id, status, version));
}

export async function setPathStatusAction(
  id: string,
  status: "chosen" | "dismissed",
): Promise<FormState> {
  const { db } = getServer();
  return runForm(PATH, (userId) => setPathStatus(db, userId, id, status));
}
