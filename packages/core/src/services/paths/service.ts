import { and, desc, eq, inArray } from "drizzle-orm";
import { type DbOrTx, schema } from "../../db";
import { deleteOwned, updateVersioned } from "../versioned";
import { type CareerPath, type CareerPathInput, careerPathInputSchema } from "./schemas";

type PathRow = typeof schema.careerPaths.$inferSelect;
const toPath = ({ userId: _u, updatedAt: _t, ...path }: PathRow) => path as CareerPath;

/** Newest first. */
export async function listPaths(
  db: DbOrTx,
  userId: string,
  filter?: { status?: CareerPath["status"][] },
): Promise<CareerPath[]> {
  const p = schema.careerPaths;
  const where = filter?.status
    ? and(eq(p.userId, userId), inArray(p.status, filter.status))
    : eq(p.userId, userId);
  const rows = await db.select().from(p).where(where).orderBy(desc(p.createdAt), desc(p.id));
  return rows.map(toPath);
}

export async function savePath(
  db: DbOrTx,
  userId: string,
  input: CareerPathInput,
): Promise<CareerPath> {
  const values = careerPathInputSchema.parse(input);
  const [row] = await db
    .insert(schema.careerPaths)
    .values({ ...values, userId })
    .returning();
  return toPath(row as PathRow);
}

export async function setPathStatus(
  db: DbOrTx,
  userId: string,
  id: string,
  status: CareerPath["status"],
): Promise<CareerPath> {
  return toPath(await updateVersioned(db, schema.careerPaths, userId, id, { status }));
}

export async function deletePath(db: DbOrTx, userId: string, id: string): Promise<void> {
  await deleteOwned(db, schema.careerPaths, userId, id);
}
