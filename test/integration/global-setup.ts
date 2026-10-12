import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { createDb, runMigrations } from "../../packages/core/src/db";
import { MIGRATIONS_FOLDER } from "./db";

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer("pgvector/pgvector:pg17").start();
  const url = container.getConnectionUri();
  const { db, pool } = createDb(url);
  try {
    await runMigrations(db, MIGRATIONS_FOLDER);
  } finally {
    await pool.end();
  }
  project.provide("databaseUrl", url);
  return async () => {
    await container.stop();
  };
}
