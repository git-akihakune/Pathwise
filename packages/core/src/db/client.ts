import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

export function createDb(
  databaseUrl: string,
  opts: { connectionTimeoutMillis?: number } = {},
): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: opts.connectionTimeoutMillis,
  });
  return { db: drizzle({ client: pool, schema }), pool };
}

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** A database handle or an open transaction. */
export type DbOrTx = Db | Tx;
