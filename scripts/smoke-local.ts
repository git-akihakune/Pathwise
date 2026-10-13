import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createAuth, signUp } from "../packages/core/src/auth";
import { loadBaseConfig } from "../packages/core/src/config";
import { createDb, runMigrations } from "../packages/core/src/db";
import { ensureInstanceSettings } from "../packages/core/src/instance";
import { coreJobs, JOBS, type JobQueue } from "../packages/core/src/jobs";
import type { ProviderStatus } from "../packages/core/src/llm";
import {
  createPastedDocument,
  type DocumentExtraction,
  getDocument,
} from "../packages/core/src/services/documents";
import { getProfile } from "../packages/core/src/services/profile";
import {
  activateProviderConfig,
  saveProviderConfig,
  testProviderConfig,
} from "../packages/core/src/services/providers";
import { importTaxonomySnapshot } from "../packages/core/src/taxonomy";
import {
  advance,
  getRun,
  reviewInputFromExtraction,
  runWorkflowTurn,
  startWorkflow,
  type WorkflowDeps,
} from "../packages/core/src/workflows";
import { parseSmokeEnv, type SmokeEnv } from "./smoke-local-env";

const CV =
  "Jamie Rivera. Warehouse Team Lead, Northside Logistics, 2019 to present: lead a team of 8 and cut picking errors by 20%. Retail Associate, Corner Market, 2016 to 2019. Skills: inventory systems, shift scheduling, forklift certification.";
const TAXONOMY_DIR = fileURLToPath(new URL("../data/taxonomy", import.meta.url));
const MIGRATIONS_DIR = fileURLToPath(new URL("../packages/core/drizzle", import.meta.url));

function reporting(output: (line: string) => void, secrets: (string | undefined)[]) {
  const log = (line: string) => {
    for (const secret of secrets) if (secret) line = line.replaceAll(secret, "[redacted]");
    output(line);
  };
  const step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      const result = await run();
      log(`✔ ${name} (${Math.round(performance.now() - started)} ms)`);
      return result;
    } catch (error) {
      log(`✘ ${name}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  };
  return { log, step };
}

/** Runs the same core flow against live providers or AI SDK mock models. */
export async function runSmokeScenario(
  deps: WorkflowDeps,
  env: SmokeEnv,
  output: (line: string) => void = console.log,
) {
  const { log, step } = reporting(output, [
    env.apiKey,
    deps.config.betterAuthSecret,
    deps.config.appEncryptionKey.toString("base64"),
  ]);
  const started = performance.now();
  let providerStatus: ProviderStatus = "untested";
  let experiences = 0;
  let skills = 0;
  let intakeReplyLength = 0;
  let completed = false;
  try {
    const userId = await step("Admin signup", async () => {
      await ensureInstanceSettings(deps.db);
      const signup = await signUp(
        { db: deps.db, auth: createAuth(deps) },
        {
          name: "Jamie Rivera",
          email: "smoke@pathwise.local",
          password: randomBytes(24).toString("base64url"),
        },
      );
      if (!signup.ok) throw new Error(`Signup failed: ${signup.reason}`);
      if (signup.role !== "admin") throw new Error("Smoke user must be the first admin");
      return signup.userId;
    });
    const actor = { userId, role: "admin" as const };
    const provider = await step("Provider config", () =>
      saveProviderConfig(deps, actor, {
        scope: "user",
        kind: "openai_compatible",
        label: "Local smoke",
        baseUrl: env.baseUrl,
        apiKey: env.apiKey,
        models: { main: env.model, fast: env.model },
        contextWindow: 8192,
      }),
    );
    providerStatus = await step("Capability probe", async () => {
      const tested = await testProviderConfig(deps, actor, provider.id);
      providerStatus = tested.status;
      for (const [name, check] of Object.entries(tested.checks)) {
        log(`  ${check.ok ? "✔" : "✘"} ${name}${check.error ? `: ${check.error}` : ""}`);
      }
      if (providerStatus === "unsupported") throw new Error("Provider is unsupported");
      log(`  ${providerStatus === "degraded" ? "degraded (acceptable)" : providerStatus}`);
      await activateProviderConfig(deps.db, userId, provider.id);
      return providerStatus;
    });
    const documentId = await step("Document parse", async () => {
      const doc = await createPastedDocument(deps, userId, { text: CV, kind: "cv" });
      const handler = coreJobs.find((job) => job.name === JOBS.documentParse);
      if (!handler) throw new Error("document.parse handler missing");
      await handler.handler(deps, handler.schema.parse({ userId, documentId: doc.id }));
      const parsed = await getDocument(deps.db, userId, doc.id);
      if (parsed.status !== "parsed")
        throw new Error(`Document status: ${parsed.status} (${parsed.error ?? "unknown"})`);
      const extraction = parsed.extraction as DocumentExtraction;
      experiences = extraction.experiences.length;
      skills = extraction.skills.length;
      if (!experiences) throw new Error("No experience extracted");
      return doc.id;
    });
    const runId = await step("Onboarding", async () => {
      const initial = await startWorkflow(deps, userId, "onboarding", { documentId });
      for (let i = 0; i < 12; i++) {
        const run = await getRun(deps.db, userId, initial.id);
        if (run.status === "completed") break;
        if (run.status !== "active") throw new Error(`Workflow status: ${run.status}`);
        const stepId = run.stepId;
        if (stepId === "review_extraction") {
          await advance(deps, userId, run.id, {
            stepId,
            uiResult: reviewInputFromExtraction(run.state.extraction as DocumentExtraction),
          });
        } else if (stepId === "intake") {
          const response = await runWorkflowTurn(deps, {
            userId,
            runId: run.id,
            message: {
              id: randomUUID(),
              role: "user",
              parts: [
                {
                  type: "text",
                  text: "I want less weekend work and more time solving problems with data.",
                },
              ],
            },
          });
          // Reading to EOF also waits for the workflow completion check.
          const body = await response.text();
          if (!response.ok) throw new Error(`Intake HTTP ${response.status}`);
          for (const line of body.split("\n")) {
            if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
            const chunk = JSON.parse(line.slice(6)) as {
              type: string;
              delta?: string;
              errorText?: string;
            };
            if (chunk.type === "error") throw new Error(chunk.errorText ?? "Intake stream failed");
            if (chunk.type === "text-delta") intakeReplyLength += chunk.delta?.length ?? 0;
          }
          if (!intakeReplyLength) throw new Error("Intake returned no reply text");
          await advance(deps, userId, run.id, { stepId, skip: true });
        } else if (stepId === "confirm") {
          await advance(deps, userId, run.id, { stepId, uiResult: {} });
        } else {
          await advance(deps, userId, run.id, { stepId });
        }
      }
      const final = await getRun(deps.db, userId, initial.id);
      if (final.status !== "completed")
        throw new Error(`Workflow did not complete: ${final.status} (${final.stepId})`);
      if (!(await getProfile(deps.db, userId)).experiences.length)
        throw new Error("Profile has no experience");
      return final.id;
    });
    completed = true;
    return { userId, runId, providerStatus, experiences, skills, intakeReplyLength };
  } finally {
    log(`\nSummary: ${completed ? "passed" : "failed"}`);
    log(`Provider: ${providerStatus}`);
    log(`Extracted: ${experiences} experiences, ${skills} skills`);
    log(`Intake reply: ${intakeReplyLength} characters`);
    log(`Scenario: ${((performance.now() - started) / 1000).toFixed(1)} seconds`);
  }
}

async function main(): Promise<number> {
  const env = parseSmokeEnv(process.env);
  if ("error" in env) {
    console.error(env.error);
    return 2;
  }
  const { log, step } = reporting(console.log, [env.apiKey]);
  const started = performance.now();
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>> | undefined;
  let pool: ReturnType<typeof createDb>["pool"] | undefined;
  let exitCode = 0;
  try {
    const deps = await step("Database and taxonomy", async () => {
      container = await new PostgreSqlContainer("pgvector/pgvector:pg17").start();
      const databaseUrl = container.getConnectionUri();
      const connection = createDb(databaseUrl);
      pool = connection.pool;
      const db = connection.db;
      await runMigrations(db, MIGRATIONS_DIR);
      await ensureInstanceSettings(db);
      await importTaxonomySnapshot(db, TAXONOMY_DIR);
      const recordedJobs: { name: string; data: object }[] = [];
      const queue: JobQueue = {
        async send(name, data) {
          recordedJobs.push({ name, data });
        },
      };
      return {
        db,
        queue,
        config: {
          ...loadBaseConfig({ DATABASE_URL: databaseUrl }),
          appEncryptionKey: randomBytes(32),
          betterAuthSecret: randomBytes(32).toString("base64"),
          llmMode: "live" as const,
        },
      };
    });
    await runSmokeScenario(deps, env);
  } catch {
    exitCode = 1;
    log("\nSummary: smoke failed (see failed step above)");
  } finally {
    try {
      await step("Close database pool", async () => {
        await pool?.end();
      });
    } catch {
      exitCode = 1;
    } finally {
      try {
        await step("Stop database container", async () => {
          await container?.stop();
        });
      } catch {
        exitCode = 1;
      }
    }
    log(`Total: ${((performance.now() - started) / 1000).toFixed(1)} seconds`);
  }
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
