import "server-only";
import type { Auth } from "@pathwise/core/auth";
import { createAuth } from "@pathwise/core/auth";
import type { AppConfig } from "@pathwise/core/config";
import { loadConfig } from "@pathwise/core/config";
import type { Db } from "@pathwise/core/db";
import { createDb } from "@pathwise/core/db";
import { nextCookies } from "better-auth/next-js";

export interface Server {
  config: AppConfig;
  db: Db;
  auth: Auth;
}

const globalForServer = globalThis as typeof globalThis & { __pathwiseServer?: Server };

/** Lazily builds config, DB pool and auth once per process (and across dev HMR reloads). */
export function getServer(): Server {
  if (!globalForServer.__pathwiseServer) {
    const config = loadConfig();
    const { db } = createDb(config.databaseUrl);
    const auth = createAuth({ db, config, plugins: [nextCookies()] });
    globalForServer.__pathwiseServer = { config, db, auth };
  }
  return globalForServer.__pathwiseServer;
}
