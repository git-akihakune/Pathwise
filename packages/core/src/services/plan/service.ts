import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type DbOrTx, schema } from "../../db";
import { ConflictError, NotFoundError } from "../../errors";
import { deleteOwned, updateVersioned } from "../versioned";
import { weekStartOf } from "./week";

export interface Milestone {
  id: string;
  title: string;
  description: string | null;
  targetDate: string | null;
  position: number;
  status: "open" | "done" | "dropped";
  version: number;
}

export interface Action {
  id: string;
  milestoneId: string | null;
  title: string;
  notes: string | null;
  weekOf: string;
  status: "todo" | "done" | "skipped";
  doneAt: Date | null;
  version: number;
}

export interface ActivePlan {
  id: string;
  northStar: string;
  careerPathId: string | null;
  version: number;
  milestones: Milestone[];
  actions: Action[];
}

const isDate = (s: string) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// No defaults anywhere below: patch schemas derive from these (zod 4's partial() keeps defaults).
export const milestoneInputSchema = z.object({
  title: z.string().trim().min(1, "Enter a milestone.").max(200),
  description: z.string().max(4000).nullish(),
  targetDate: ymd.refine(isDate, "Enter a valid date.").nullish(),
});

export const actionInputSchema = z.object({
  title: z.string().trim().min(1, "Enter an action.").max(200),
  notes: z.string().max(4000).nullish(),
  weekOf: ymd.refine((s) => isDate(s) && weekStartOf(s) === s, "Week must start on a Monday."),
  milestoneId: z.string().uuid().nullish(),
});

const northStarSchema = z.string().trim().min(1, "Enter a north star.").max(500);

export const createPlanInputSchema = z
  .object({
    northStar: northStarSchema,
    careerPathId: z.string().uuid().optional(),
    milestones: z.array(milestoneInputSchema).max(12),
    actions: z
      .array(
        actionInputSchema.omit({ milestoneId: true }).extend({
          milestoneIndex: z.number().int().min(0).optional(),
        }),
      )
      .max(50),
  })
  .superRefine((plan, ctx) => {
    plan.actions.forEach((a, i) => {
      if (a.milestoneIndex !== undefined && a.milestoneIndex >= plan.milestones.length) {
        ctx.addIssue({
          code: "custom",
          message: "Unknown milestone.",
          path: ["actions", i, "milestoneIndex"],
        });
      }
    });
  });

export type MilestoneInput = z.input<typeof milestoneInputSchema>;
export type ActionInput = z.input<typeof actionInputSchema>;

const milestonePatchSchema = milestoneInputSchema
  .extend({
    status: z.enum(["open", "done", "dropped"]),
    position: z.number().int().min(0),
  })
  .partial();
const actionPatchSchema = actionInputSchema.partial();

type MilestoneRow = typeof schema.milestones.$inferSelect;
type ActionRow = typeof schema.actions.$inferSelect;
const toMilestone = (r: MilestoneRow): Milestone => ({
  id: r.id,
  title: r.title,
  description: r.description,
  targetDate: r.targetDate,
  position: r.position,
  status: r.status as Milestone["status"],
  version: r.version,
});
const toAction = (r: ActionRow): Action => ({
  id: r.id,
  milestoneId: r.milestoneId,
  title: r.title,
  notes: r.notes,
  weekOf: r.weekOf,
  status: r.status as Action["status"],
  doneAt: r.doneAt,
  version: r.version,
});

async function loadPlan(db: DbOrTx, plan: typeof schema.plans.$inferSelect): Promise<ActivePlan> {
  const m = schema.milestones;
  const a = schema.actions;
  const milestones = await db
    .select()
    .from(m)
    .where(and(eq(m.planId, plan.id), eq(m.userId, plan.userId)))
    .orderBy(asc(m.position), asc(m.createdAt), asc(m.id));
  const actions = await db
    .select()
    .from(a)
    .where(and(eq(a.planId, plan.id), eq(a.userId, plan.userId)))
    .orderBy(asc(a.weekOf), asc(a.createdAt), asc(a.id));
  return {
    id: plan.id,
    northStar: plan.northStar,
    careerPathId: plan.careerPathId,
    version: plan.version,
    milestones: milestones.map(toMilestone),
    actions: actions.map(toAction),
  };
}

export async function getActivePlan(db: DbOrTx, userId: string): Promise<ActivePlan | null> {
  const p = schema.plans;
  const [plan] = await db
    .select()
    .from(p)
    .where(and(eq(p.userId, userId), eq(p.status, "active")));
  return plan ? loadPlan(db, plan) : null;
}

export async function createPlan(
  db: DbOrTx,
  userId: string,
  input: z.input<typeof createPlanInputSchema>,
): Promise<ActivePlan> {
  const data = createPlanInputSchema.parse(input);
  return db.transaction(async (tx) => {
    // Serializes creates per user, so racing creates never reach the one-active-plan index.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`pathwise.plan:${userId}`}, 0))`,
    );
    if (data.careerPathId) {
      await updateVersioned(tx, schema.careerPaths, userId, data.careerPathId, {
        status: "chosen",
      });
    }
    await tx
      .update(schema.plans)
      .set({ status: "archived", version: sql`${schema.plans.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(schema.plans.userId, userId), eq(schema.plans.status, "active")));
    const [plan] = await tx
      .insert(schema.plans)
      .values({
        userId,
        northStar: data.northStar,
        careerPathId: data.careerPathId ?? null,
      })
      .returning();
    const planId = (plan as typeof schema.plans.$inferSelect).id;
    const milestoneRows =
      data.milestones.length === 0
        ? []
        : await tx
            .insert(schema.milestones)
            .values(
              data.milestones.map((m, position) => ({
                userId,
                planId,
                title: m.title,
                description: m.description ?? null,
                targetDate: m.targetDate ?? null,
                position,
              })),
            )
            .returning();
    if (data.actions.length > 0) {
      const byPosition = new Map(milestoneRows.map((m) => [m.position, m.id]));
      await tx.insert(schema.actions).values(
        data.actions.map((a) => ({
          userId,
          planId,
          milestoneId:
            a.milestoneIndex === undefined ? null : (byPosition.get(a.milestoneIndex) ?? null),
          title: a.title,
          notes: a.notes ?? null,
          weekOf: a.weekOf,
        })),
      );
    }
    return loadPlan(tx, plan as typeof schema.plans.$inferSelect);
  });
}

/** Loads and locks the user's plan, so an edit can't interleave with a create archiving it. */
async function lockEditablePlan(db: DbOrTx, userId: string, planId: string) {
  const p = schema.plans;
  const [plan] = await db
    .select()
    .from(p)
    .where(and(eq(p.id, planId), eq(p.userId, userId)))
    .for("update");
  if (!plan) throw new NotFoundError("Not found.");
  if (plan.status === "archived") throw new ConflictError("This plan is archived.");
  return plan;
}

async function bumpPlan(db: DbOrTx, planId: string): Promise<void> {
  await db
    .update(schema.plans)
    .set({ version: sql`${schema.plans.version} + 1`, updatedAt: sql`now()` })
    .where(eq(schema.plans.id, planId));
}

/** Runs a structural edit of one plan's contents and bumps `plans.version` afterwards. */
function editPlan<T>(
  db: DbOrTx,
  userId: string,
  planId: string,
  edit: (tx: DbOrTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockEditablePlan(tx, userId, planId);
    const result = await edit(tx);
    await bumpPlan(tx, planId);
    return result;
  });
}

/** Resolves the plan that owns a milestone or action (a miss is a `NotFoundError`). */
async function planIdOf(
  db: DbOrTx,
  table: typeof schema.milestones | typeof schema.actions,
  userId: string,
  id: string,
): Promise<string> {
  const [row] = await db
    .select({ planId: table.planId })
    .from(table)
    .where(and(eq(table.id, id), eq(table.userId, userId)));
  if (!row) throw new NotFoundError("Not found.");
  return row.planId;
}

async function assertMilestoneInPlan(
  db: DbOrTx,
  userId: string,
  planId: string,
  milestoneId: string | null | undefined,
): Promise<void> {
  if (!milestoneId) return;
  const m = schema.milestones;
  const [row] = await db
    .select({ id: m.id })
    .from(m)
    .where(and(eq(m.id, milestoneId), eq(m.planId, planId), eq(m.userId, userId)));
  if (!row) throw new NotFoundError("Not found.");
}

export async function updatePlan(
  db: DbOrTx,
  userId: string,
  planId: string,
  patch: { northStar?: string },
  expectedVersion?: number,
): Promise<ActivePlan> {
  const set =
    patch.northStar === undefined ? {} : { northStar: northStarSchema.parse(patch.northStar) };
  return db.transaction(async (tx) => {
    await lockEditablePlan(tx, userId, planId);
    const row = await updateVersioned(tx, schema.plans, userId, planId, set, expectedVersion);
    return loadPlan(tx, row);
  });
}

export async function addMilestone(
  db: DbOrTx,
  userId: string,
  planId: string,
  input: MilestoneInput,
): Promise<Milestone> {
  const data = milestoneInputSchema.parse(input);
  return editPlan(db, userId, planId, async (tx) => {
    const m = schema.milestones;
    const [last] = await tx
      .select({ position: sql<number>`coalesce(max(${m.position}), -1)` })
      .from(m)
      .where(and(eq(m.planId, planId), eq(m.userId, userId)));
    const [row] = await tx
      .insert(m)
      .values({
        userId,
        planId,
        title: data.title,
        description: data.description ?? null,
        targetDate: data.targetDate ?? null,
        position: (last?.position ?? -1) + 1,
      })
      .returning();
    return toMilestone(row as MilestoneRow);
  });
}

export async function updateMilestone(
  db: DbOrTx,
  userId: string,
  milestoneId: string,
  patch: Partial<MilestoneInput> & { status?: Milestone["status"]; position?: number },
  expectedVersion?: number,
): Promise<Milestone> {
  const set = milestonePatchSchema.parse(patch);
  return db.transaction(async (tx) => {
    const planId = await planIdOf(tx, schema.milestones, userId, milestoneId);
    return editPlan(tx, userId, planId, async (inner) =>
      toMilestone(
        await updateVersioned(inner, schema.milestones, userId, milestoneId, set, expectedVersion),
      ),
    );
  });
}

export async function removeMilestone(
  db: DbOrTx,
  userId: string,
  milestoneId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const planId = await planIdOf(tx, schema.milestones, userId, milestoneId);
    await editPlan(tx, userId, planId, (inner) =>
      deleteOwned(inner, schema.milestones, userId, milestoneId),
    );
  });
}

export async function addAction(
  db: DbOrTx,
  userId: string,
  planId: string,
  input: ActionInput,
): Promise<Action> {
  const data = actionInputSchema.parse(input);
  return editPlan(db, userId, planId, async (tx) => {
    await assertMilestoneInPlan(tx, userId, planId, data.milestoneId);
    const [row] = await tx
      .insert(schema.actions)
      .values({
        userId,
        planId,
        title: data.title,
        notes: data.notes ?? null,
        weekOf: data.weekOf,
        milestoneId: data.milestoneId ?? null,
      })
      .returning();
    return toAction(row as ActionRow);
  });
}

export async function updateAction(
  db: DbOrTx,
  userId: string,
  actionId: string,
  patch: Partial<ActionInput>,
  expectedVersion?: number,
): Promise<Action> {
  const set = actionPatchSchema.parse(patch);
  return db.transaction(async (tx) => {
    const planId = await planIdOf(tx, schema.actions, userId, actionId);
    return editPlan(tx, userId, planId, async (inner) => {
      await assertMilestoneInPlan(inner, userId, planId, set.milestoneId);
      return toAction(
        await updateVersioned(inner, schema.actions, userId, actionId, set, expectedVersion),
      );
    });
  });
}

export async function removeAction(db: DbOrTx, userId: string, actionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const planId = await planIdOf(tx, schema.actions, userId, actionId);
    await editPlan(tx, userId, planId, (inner) =>
      deleteOwned(inner, schema.actions, userId, actionId),
    );
  });
}

/** Changes the action only; `plans.version` stays, so ticking a box never stales a plan edit. */
export async function setActionStatus(
  db: DbOrTx,
  userId: string,
  actionId: string,
  status: Action["status"],
  expectedVersion?: number,
): Promise<Action> {
  const row = await updateVersioned(
    db,
    schema.actions,
    userId,
    actionId,
    { status, doneAt: status === "done" ? new Date() : null },
    expectedVersion,
  );
  return toAction(row);
}

/** Actions of the active plan scheduled for the week starting on `weekOf`. */
export async function actionsForWeek(
  db: DbOrTx,
  userId: string,
  weekOf: string,
): Promise<Action[]> {
  const a = schema.actions;
  const rows = await db
    .select({ action: a })
    .from(a)
    .innerJoin(schema.plans, eq(schema.plans.id, a.planId))
    .where(and(eq(a.userId, userId), eq(a.weekOf, weekOf), eq(schema.plans.status, "active")))
    .orderBy(asc(a.createdAt), asc(a.id));
  return rows.map((r) => toAction(r.action));
}
