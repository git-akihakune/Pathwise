import { and, desc, eq, inArray } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { type DbOrTx, schema } from "../../db";
import { ConflictError, NotFoundError } from "../../errors";
import { addMemory, setMemoryStatus, updateMemory } from "../memory";
import { savePath } from "../paths";
import {
  addAction,
  addMilestone,
  createPlan,
  getActivePlan,
  lockPlanCreation,
  removeAction,
  removeMilestone,
  setActionStatus,
  updateAction,
  updateMilestone,
  updatePlan,
} from "../plan";
import {
  createEducation,
  createExperience,
  createSkill,
  deleteEducation,
  deleteExperience,
  deleteSkill,
  updateEducation,
  updateExperience,
  updateSkill,
} from "../profile";
import { createStory, updateStory } from "../stories";
import {
  type ProposalKind,
  type ProposalPayload,
  type ProposalPayloads,
  type ProposalStatus,
  proposalPayloadSchemas,
} from "./schemas";

export interface Proposal {
  id: string;
  kind: ProposalKind;
  payload: unknown;
  targetId: string | null;
  targetVersion: number | null;
  status: ProposalStatus;
  sessionId: string | null;
  messageId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

type Row = typeof schema.proposals.$inferSelect;
const toProposal = ({ userId: _u, updatedAt: _t, ...p }: Row) => p as Proposal;

const PROFILE_TABLES = {
  experience: schema.experiences,
  education: schema.education,
  skill: schema.skills,
} as const;

type Versioned = PgTable & {
  id: typeof schema.stories.id;
  userId: typeof schema.stories.userId;
  version: typeof schema.stories.version;
};

/** The row a proposal is based on, if it has one. */
function targetTable(
  kind: ProposalKind,
  payload: unknown,
): { table: Versioned; id: string } | null {
  if (kind === "profile_update") {
    const p = payload as ProposalPayloads["profile_update"];
    if (p.op === "create" || !p.id) return null;
    return { table: PROFILE_TABLES[p.entity] as unknown as Versioned, id: p.id };
  }
  if (kind === "memory_update") {
    return {
      table: schema.memoryItems as unknown as Versioned,
      id: (payload as ProposalPayloads["memory_update"]).id,
    };
  }
  if (kind === "story_update") {
    return { table: schema.stories, id: (payload as ProposalPayloads["story_update"]).id };
  }
  return null;
}

/** Reads (and with `lock`, locks) a target's version; a missing row is a `NotFoundError`. */
async function readVersion(
  db: DbOrTx,
  userId: string,
  { table, id }: { table: Versioned; id: string },
  lock: boolean,
): Promise<number> {
  const query = db
    .select({ version: table.version })
    .from(table)
    .where(and(eq(table.id, id), eq(table.userId, userId)));
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw new NotFoundError("Not found.");
  return row.version;
}

async function memoryStatus(
  db: DbOrTx,
  userId: string,
  id: string,
  lock: boolean,
): Promise<string> {
  const m = schema.memoryItems;
  const query = db
    .select({ status: m.status })
    .from(m)
    .where(and(eq(m.id, id), eq(m.userId, userId)));
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw new NotFoundError("Not found.");
  return row.status;
}

export async function createProposal<K extends ProposalKind>(
  db: DbOrTx,
  userId: string,
  input: { kind: K; payload: ProposalPayload<K>; sessionId?: string; messageId?: string },
): Promise<Proposal> {
  const payload = proposalPayloadSchemas[input.kind].parse(input.payload);
  let target: { id: string | null; version: number | null } = { id: null, version: null };
  const row = targetTable(input.kind, payload);
  if (row) {
    target = { id: row.id, version: await readVersion(db, userId, row, false) };
    if (input.kind === "memory_update") {
      const status = await memoryStatus(db, userId, row.id, false);
      if (status !== "active" && status !== "pending") {
        throw new ConflictError("That item is no longer active.");
      }
    }
  } else if (input.kind === "plan_create" || input.kind === "plan_change") {
    const plan = await getActivePlan(db, userId);
    if (plan) target = { id: plan.id, version: plan.version };
    else if (input.kind === "plan_change") throw new NotFoundError("No active plan.");
  } else if (input.kind === "action_status_update") {
    const ids = (payload as ProposalPayloads["action_status_update"]).updates.map(
      (u) => u.actionId,
    );
    const found = await db
      .select({ id: schema.actions.id })
      .from(schema.actions)
      .where(and(eq(schema.actions.userId, userId), inArray(schema.actions.id, ids)));
    if (found.length !== ids.length) throw new NotFoundError("Not found.");
  }
  const [created] = await db
    .insert(schema.proposals)
    .values({
      userId,
      kind: input.kind,
      payload,
      targetId: target.id,
      targetVersion: target.version,
      sessionId: input.sessionId ?? null,
      messageId: input.messageId ?? null,
    })
    .returning();
  return toProposal(created as Row);
}

export async function listProposals(
  db: DbOrTx,
  userId: string,
  filter: { status?: ProposalStatus[]; sessionId?: string } = {},
): Promise<Proposal[]> {
  const p = schema.proposals;
  const rows = await db
    .select()
    .from(p)
    .where(
      and(
        eq(p.userId, userId),
        filter.status ? inArray(p.status, filter.status) : undefined,
        filter.sessionId ? eq(p.sessionId, filter.sessionId) : undefined,
      ),
    )
    .orderBy(desc(p.createdAt), desc(p.id));
  return rows.map(toProposal);
}

export async function getProposal(db: DbOrTx, userId: string, id: string): Promise<Proposal> {
  const p = schema.proposals;
  const [row] = await db
    .select()
    .from(p)
    .where(and(eq(p.id, id), eq(p.userId, userId)));
  if (!row) throw new NotFoundError("Not found.");
  return toProposal(row);
}

/** Locks a pending proposal; resolving one twice is a `ConflictError`. */
async function lockPending(db: DbOrTx, userId: string, id: string): Promise<Row> {
  const p = schema.proposals;
  const [row] = await db
    .select()
    .from(p)
    .where(and(eq(p.id, id), eq(p.userId, userId)))
    .for("update");
  if (!row) throw new NotFoundError("Not found.");
  if (row.status !== "pending") throw new ConflictError("This proposal was already resolved.");
  return row;
}

async function resolve(
  db: DbOrTx,
  userId: string,
  id: string,
  status: ProposalStatus,
  extra: { payload?: unknown; resolved: boolean },
): Promise<void> {
  await db
    .update(schema.proposals)
    .set({
      status,
      ...(extra.payload === undefined ? {} : { payload: extra.payload }),
      ...(extra.resolved ? { resolvedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.proposals.id, id), eq(schema.proposals.userId, userId)));
}

const CHANGED_TARGET = "An edit can't change what the proposal targets.";

/** An edit may change what is written, never which row (or rows) it is written to. */
function assertSameTarget(kind: ProposalKind, stored: unknown, edited: unknown): void {
  let same = true;
  if (kind === "profile_update") {
    const a = stored as ProposalPayloads["profile_update"];
    const b = edited as ProposalPayloads["profile_update"];
    same = a.entity === b.entity && a.op === b.op && a.id === b.id;
  } else if (kind === "memory_update" || kind === "story_update") {
    same = (stored as { id: string }).id === (edited as { id: string }).id;
  } else if (kind === "action_status_update") {
    const original = new Set(
      (stored as ProposalPayloads["action_status_update"]).updates.map((u) => u.actionId),
    );
    same = (edited as ProposalPayloads["action_status_update"]).updates.every((u) =>
      original.has(u.actionId),
    );
  }
  if (!same) throw new ConflictError(CHANGED_TARGET);
}

/** An edit can't refresh a staleness check: each update keeps the version it was proposed against. */
function pinStoredVersions(stored: unknown, edited: unknown): void {
  const versions = new Map(
    (stored as ProposalPayloads["action_status_update"]).updates.map((u) => [
      u.actionId,
      u.basedOnVersion,
    ]),
  );
  for (const u of (edited as ProposalPayloads["action_status_update"]).updates) {
    u.basedOnVersion = versions.get(u.actionId) ?? u.basedOnVersion;
  }
}

async function apply(tx: DbOrTx, userId: string, proposal: Row, payload: unknown): Promise<void> {
  const kind = proposal.kind as ProposalKind;
  const provenance = { sourceType: "message", sourceId: proposal.messageId } as const;
  const target = targetTable(kind, payload);
  if (target) {
    const version = await readVersion(tx, userId, target, true);
    if (version !== proposal.targetVersion) throw new ConflictError("This item has changed.");
  }
  switch (kind) {
    case "profile_update": {
      const p = payload as ProposalPayloads["profile_update"];
      const fields = (p.fields ?? {}) as never;
      const id = p.id as string;
      if (p.entity === "experience") {
        if (p.op === "create")
          await createExperience(tx, userId, { ...(fields as object), ...provenance } as never);
        else if (p.op === "update") await updateExperience(tx, userId, id, fields);
        else await deleteExperience(tx, userId, id);
      } else if (p.entity === "education") {
        if (p.op === "create")
          await createEducation(tx, userId, { ...(fields as object), ...provenance } as never);
        else if (p.op === "update") await updateEducation(tx, userId, id, fields);
        else await deleteEducation(tx, userId, id);
      } else if (p.op === "create") {
        await createSkill(tx, userId, { ...(fields as object), ...provenance } as never);
      } else if (p.op === "update") {
        await updateSkill(tx, userId, id, fields);
      } else {
        await deleteSkill(tx, userId, id);
      }
      return;
    }
    case "memory_add":
      await addMemory(tx, userId, {
        ...(payload as ProposalPayloads["memory_add"]),
        ...provenance,
        status: "active",
        confidence: 1,
      });
      return;
    case "memory_update": {
      const { id, ...patch } = payload as ProposalPayloads["memory_update"];
      const status = await memoryStatus(tx, userId, id, true);
      if (status !== "active" && status !== "pending") {
        throw new ConflictError("That item is no longer active.");
      }
      await updateMemory(tx, userId, id, patch);
      // Facts approved through a proposal are always active (spec §5.6).
      if (status === "pending") await setMemoryStatus(tx, userId, id, "active");
      return;
    }
    case "story_add":
      await createStory(tx, userId, {
        ...(payload as ProposalPayloads["story_add"]),
        ...provenance,
      });
      return;
    case "story_update": {
      const { id, fields } = payload as ProposalPayloads["story_update"];
      await updateStory(tx, userId, id, fields);
      return;
    }
    case "path_save":
      await savePath(tx, userId, payload as ProposalPayloads["path_save"]);
      return;
    case "plan_create": {
      // Same lock createPlan takes, so a concurrent manual create can't slip in after the check.
      await lockPlanCreation(tx, userId);
      const active = await getActivePlan(tx, userId);
      if (
        (active?.id ?? null) !== proposal.targetId ||
        (active?.version ?? null) !== proposal.targetVersion
      ) {
        throw new ConflictError("Your plan changed after this was proposed.");
      }
      await createPlan(tx, userId, payload as ProposalPayloads["plan_create"]);
      return;
    }
    case "plan_change":
      await applyPlanChange(tx, userId, proposal, payload as ProposalPayloads["plan_change"]);
      return;
    case "action_status_update":
      for (const u of (payload as ProposalPayloads["action_status_update"]).updates) {
        await setActionStatus(tx, userId, u.actionId, u.status, u.basedOnVersion);
      }
      return;
  }
}

async function applyPlanChange(
  tx: DbOrTx,
  userId: string,
  proposal: Row,
  change: ProposalPayloads["plan_change"],
): Promise<void> {
  const planId = proposal.targetId as string;
  // Lock the plan row before comparing, so a manual edit can't commit between the check and the writes.
  const p = schema.plans;
  const [plan] = await tx
    .select({ version: p.version, status: p.status })
    .from(p)
    .where(and(eq(p.id, planId), eq(p.userId, userId)))
    .for("update");
  if (plan?.status !== "active" || plan.version !== proposal.targetVersion) {
    throw new ConflictError("Your plan changed after this was proposed.");
  }
  if (change.northStar !== undefined) {
    await updatePlan(tx, userId, planId, { northStar: change.northStar });
  }
  for (const m of change.milestones.add) await addMilestone(tx, userId, planId, m);
  for (const { id, ...patch } of change.milestones.update)
    await updateMilestone(tx, userId, id, patch);
  for (const id of change.milestones.remove) await removeMilestone(tx, userId, id);
  for (const a of change.actions.add) await addAction(tx, userId, planId, a);
  for (const { id, ...patch } of change.actions.update) await updateAction(tx, userId, id, patch);
  for (const id of change.actions.remove) await removeAction(tx, userId, id);
}

export async function approveProposal(
  db: DbOrTx,
  userId: string,
  id: string,
  opts: { editedPayload?: unknown } = {},
): Promise<{ status: "approved" | "conflicted" }> {
  return db.transaction(async (tx) => {
    const proposal = await lockPending(tx, userId, id);
    const kind = proposal.kind as ProposalKind;
    let payload = proposal.payload;
    if (opts.editedPayload !== undefined) {
      payload = proposalPayloadSchemas[kind].parse(opts.editedPayload);
      assertSameTarget(kind, proposal.payload, payload);
      if (kind === "action_status_update") pinStoredVersions(proposal.payload, payload);
    }
    try {
      await tx.transaction((savepoint) => apply(savepoint, userId, proposal, payload));
    } catch (e) {
      if (!(e instanceof ConflictError || e instanceof NotFoundError)) throw e;
      await resolve(tx, userId, id, "conflicted", { resolved: false });
      return { status: "conflicted" as const };
    }
    await resolve(tx, userId, id, "approved", { payload, resolved: true });
    return { status: "approved" as const };
  });
}

export async function rejectProposal(db: DbOrTx, userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockPending(tx, userId, id);
    await resolve(tx, userId, id, "rejected", { resolved: true });
  });
}
