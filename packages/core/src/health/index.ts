import { sql } from "drizzle-orm";
import type { Db } from "../db";

export async function checkHealth(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
