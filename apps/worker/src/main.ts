import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@pathwise/core/config";
import { startTelemetry } from "@pathwise/core/telemetry";
import { runCli } from "./cli";
import { runInit } from "./init";
import { startWorker } from "./worker";

const here = dirname(fileURLToPath(import.meta.url));
const bundled = join(here, "drizzle");
const migrationsFolder = existsSync(bundled)
  ? bundled
  : join(here, "../../../packages/core/drizzle");

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "init":
    await runInit(process.env, { migrationsFolder });
    break;
  case "worker": {
    const config = loadConfig();
    const stopTracing = await startTelemetry(config, "pathwise-worker");
    await startWorker(config, { stopTracing });
    break;
  }
  case "pathwise":
    process.exitCode = await runCli(rest);
    break;
  default:
    console.error("Usage: main.js <init|worker|pathwise>");
    process.exitCode = 2;
}
