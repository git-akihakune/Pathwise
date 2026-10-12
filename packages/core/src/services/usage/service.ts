import { asc, eq, gte, sql } from "drizzle-orm";
import { assertAdmin } from "../../admin";
import { type Db, schema } from "../../db";

export interface UsageRow {
  userId: string;
  email: string;
  role: string;
  inputTokens: number;
  outputTokens: number;
}

/** Token totals per user and role since `since`. Admin-only; users without usage are omitted. */
export async function usageByUser(db: Db, actorId: string, since: Date): Promise<UsageRow[]> {
  await assertAdmin(db, actorId);
  const { llmUsage, user } = schema;
  const rows = await db
    .select({
      userId: llmUsage.userId,
      email: user.email,
      role: llmUsage.role,
      inputTokens: sql<string>`sum(${llmUsage.inputTokens})`,
      outputTokens: sql<string>`sum(${llmUsage.outputTokens})`,
    })
    .from(llmUsage)
    .innerJoin(user, eq(user.id, llmUsage.userId))
    .where(gte(llmUsage.createdAt, since))
    .groupBy(llmUsage.userId, user.email, llmUsage.role)
    .orderBy(
      asc(user.email),
      sql`array_position(array['main','fast','embedding'], ${llmUsage.role})`,
    );
  return rows.map((r) => ({
    ...r,
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
  }));
}
