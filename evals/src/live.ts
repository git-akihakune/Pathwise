import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runTurn, type TurnDeps, type TurnResult } from "@pathwise/core/agent";
import { createAuth, createCredentialUser, signUp } from "@pathwise/core/auth";
import { loadBaseConfig } from "@pathwise/core/config";
import { createDb, runMigrations } from "@pathwise/core/db";
import { ensureInstanceSettings } from "@pathwise/core/instance";
import { generateStructured, type Llm, requireLlm } from "@pathwise/core/llm";
import { applyPersona } from "@pathwise/core/seed";
import { listProposals } from "@pathwise/core/services/proposals";
import {
  activateProviderConfig,
  saveProviderConfig,
  setInstanceProviderConfig,
  testProviderConfig,
} from "@pathwise/core/services/providers";
import { recentMessages } from "@pathwise/core/services/sessions";
import { importTaxonomySnapshot } from "@pathwise/core/taxonomy";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { EvalEnv } from "./env";
import { type EvalPersona, PERSONAS } from "./personas";
import { judgeInstructions, verdictSchema } from "./rubric";
import type { EvalArgs } from "./run";
import { type EvalScenario, personaForScenario, SCENARIOS } from "./scenarios";
import { simulateUserReply } from "./simulate";
import { summarize } from "./summary";
import type { CaseResult, RunResult } from "./types";

export async function collectTurn(
  deps: TurnDeps,
  userId: string,
  text: string,
): Promise<CaseResult["transcript"][number]> {
  let final: TurnResult | undefined;
  const response = await runTurn(
    deps,
    { userId, message: { id: randomUUID(), role: "user", parts: [{ type: "text", text }] } },
    {
      onTurnEnd: async (result) => {
        final = result;
      },
    },
  );
  // EOF waits for core's persistence and onTurnEnd hook, including failed streams.
  const body = await response.text();
  if (!response.ok) throw new Error(`Turn HTTP ${response.status}`);
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ") || line.trim() === "data: [DONE]") continue;
    const chunk = JSON.parse(line.slice(6)) as {
      type?: string;
      errorText?: string;
      finishReason?: string;
    };
    if (chunk.type === "error") throw new Error(chunk.errorText ?? "Turn stream failed");
    if (chunk.type === "finish" && chunk.finishReason === "error")
      throw new Error("Turn stream failed");
  }
  if (!final) throw new Error("Turn finalization did not run");
  if (final.status !== "complete") throw new Error(`Turn ${final.status}`);
  const assistantMessageId = final.assistantMessageId;
  const persisted = (await recentMessages(deps.db, userId, final.sessionId)).find(
    (m) => m.id === assistantMessageId,
  );
  if (!persisted || persisted.metadata?.status === "interrupted")
    throw new Error("Assistant reply was not persisted completely");
  const textParts = persisted.parts.flatMap((p) => (p.type === "text" ? [p.text] : []));
  const reply = textParts.join("\n");
  if (!reply.trim()) throw new Error("Turn returned no reply text");
  const toolCalls = persisted.parts.flatMap((p) =>
    p.type === "dynamic-tool" ? [p.toolName] : p.type.startsWith("tool-") ? [p.type.slice(5)] : [],
  );
  return { role: "assistant", text: reply, toolCalls };
}

export const TAXONOMY_DIR = fileURLToPath(new URL("../../data/taxonomy", import.meta.url));

export async function evaluateCase(
  deps: TurnDeps,
  judge: Llm,
  persona: EvalPersona,
  scenario: EvalScenario,
): Promise<CaseResult> {
  const result: CaseResult = {
    persona: persona.id,
    scenario: scenario.id,
    transcript: [],
    proposals: [],
    scores: {},
  };
  try {
    const { userId } = await createCredentialUser(deps.db, {
      name: persona.data.name,
      email: `${persona.id}-${scenario.id}@evals.local`,
      role: "user",
      emailVerified: true,
    });
    await applyPersona(deps.db, userId, personaForScenario(persona, scenario), new Date());
    let message = scenario.opening;
    for (let turn = 0; turn <= scenario.followUps; turn++) {
      result.transcript.push({ role: "user", text: message });
      result.transcript.push(await collectTurn(deps, userId, message));
      if (turn < scenario.followUps) {
        message = await simulateUserReply(deps, judge, persona, result.transcript);
        if (!message.trim()) throw new Error("Simulated user returned no reply text");
      }
    }
    result.proposals = (await listProposals(deps.db, userId, { status: ["pending"] })).map((p) => ({
      kind: p.kind,
      payload: p.payload,
    }));
    result.scores = await generateStructured(deps, judge, {
      role: "main",
      purpose: "eval.judge",
      schema: verdictSchema(scenario.criteria),
      instructions: judgeInstructions(scenario.criteria, persona.facts),
      prompt: `<transcript>\n${JSON.stringify(result.transcript)}\n</transcript>\n<proposals>\n${JSON.stringify(result.proposals)}\n</proposals>`,
    });
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  return result;
}

export async function runLiveEval(
  env: EvalEnv,
  options: Extract<EvalArgs, { mode: "run" }>,
  log: (line: string) => void,
): Promise<{ run: RunResult; cleanupFailed: boolean }> {
  const run: RunResult = {
    startedAt: new Date().toISOString(),
    models: { kind: env.kind, main: env.mainModel, fast: env.fastModel, judge: env.judgeModel },
    cases: [],
    summary: summarize([]),
  };
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>> | undefined;
  let pool: ReturnType<typeof createDb>["pool"] | undefined;
  let cleanupFailed = false;
  try {
    log("Starting isolated database and importing bundled taxonomy");
    container = await new PostgreSqlContainer("pgvector/pgvector:pg17").start();
    const databaseUrl = container.getConnectionUri();
    const connection = createDb(databaseUrl);
    pool = connection.pool;
    const db = connection.db;
    await runMigrations(db, fileURLToPath(new URL("../../packages/core/drizzle", import.meta.url)));
    await ensureInstanceSettings(db);
    await importTaxonomySnapshot(db, TAXONOMY_DIR);
    const deps: TurnDeps = {
      db,
      queue: { async send() {} },
      config: {
        ...loadBaseConfig({ DATABASE_URL: databaseUrl }),
        appEncryptionKey: randomBytes(32),
        betterAuthSecret: randomBytes(32).toString("base64"),
        llmMode: "live",
      },
    };
    const signup = await signUp(
      { db, auth: createAuth(deps) },
      {
        name: "Eval Admin",
        email: "admin@evals.local",
        password: randomBytes(24).toString("base64url"),
      },
    );
    if (!signup.ok || signup.role !== "admin") throw new Error("Eval admin bootstrap failed");
    const admin = { userId: signup.userId, role: "admin" as const };
    const input = {
      kind: env.kind,
      apiKey: env.apiKey,
      baseUrl: env.baseUrl,
      ...(env.kind === "openai_compatible" ? { contextWindow: 16384 } : {}),
    };
    const instance = await setInstanceProviderConfig(deps, signup.userId, {
      ...input,
      label: "Eval coach",
      models: { main: env.mainModel, fast: env.fastModel },
    });
    log("Probing coach provider");
    const coachProbe = await testProviderConfig(deps, admin, instance.id);
    if (coachProbe.status === "unsupported" || coachProbe.authFailed)
      throw new Error("Coach provider probe failed");
    log(`Coach provider: ${coachProbe.status}`);
    // Custom/private endpoints require an admin actor. This isolated account owns only the judge config.
    const judgeUser = await createCredentialUser(db, {
      name: "Eval Judge",
      email: "judge@evals.local",
      role: "admin",
      emailVerified: true,
    });
    const actor = { userId: judgeUser.userId, role: "admin" as const };
    const config = await saveProviderConfig(deps, actor, {
      ...input,
      scope: "user",
      label: "Eval judge",
      models: { main: env.judgeModel, fast: env.judgeModel },
    });
    log("Probing judge provider");
    const judgeProbe = await testProviderConfig(deps, actor, config.id);
    if (judgeProbe.status === "unsupported" || judgeProbe.authFailed)
      throw new Error("Judge provider probe failed");
    await activateProviderConfig(db, judgeUser.userId, config.id);
    const judge = await requireLlm(deps, judgeUser.userId);
    log(`Judge provider: ${judgeProbe.status}`);
    const personas = PERSONAS.filter((p) => !options.persona || p.id === options.persona);
    const scenarios = SCENARIOS.filter((s) => !options.scenario || s.id === options.scenario);
    for (const persona of personas)
      for (const scenario of scenarios) {
        const started = performance.now();
        log(`Starting ${persona.id}/${scenario.id}`);
        const result = await evaluateCase(deps, judge, persona, scenario);
        run.cases.push(result);
        log(
          `${result.error !== undefined ? "FAILED" : "Scored"} ${persona.id}/${scenario.id} (${Math.round((performance.now() - started) / 1000)} s)${result.error !== undefined ? `: ${result.error}` : ""}`,
        );
      }
    run.summary = summarize(run.cases);
  } finally {
    try {
      await pool?.end();
    } catch {
      cleanupFailed = true;
      log("Failed to close database pool");
    } finally {
      try {
        await container?.stop();
      } catch {
        cleanupFailed = true;
        log("Failed to stop database container");
      }
    }
  }
  return { run, cleanupFailed };
}
