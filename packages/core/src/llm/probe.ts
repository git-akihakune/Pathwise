import {
  APICallError,
  generateText,
  type LanguageModel,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  streamText,
  tool,
} from "ai";
import { z } from "zod";
import { isAuthError } from "./auth";
import { createLanguageModel, type ProviderTarget } from "./factory";
import { contextWindowFor, staticPdfInput } from "./models";
import type { Capabilities, LlmDeps, ProbeCheckName, ProbeChecks, ProviderStatus } from "./types";
import { recordUsage } from "./usage";

export interface ProbeTarget extends ProviderTarget {
  /** Whose usage the probe records. */
  userId: string;
}
export interface ProbeResult {
  capabilities: Capabilities;
  status: ProviderStatus;
  checks: ProbeChecks;
  /** True when a check failed because the provider rejected the key (401/403). */
  authRejected: boolean;
}

const TIMEOUT_MS = 60_000;
const INSTRUCTIONS = "You are a connectivity test. Follow the instruction exactly.";
const SKIPPED = "Skipped because the basic check failed.";

export function statusFromChecks(checks: ProbeChecks): ProviderStatus {
  if (!checks.basic.ok || !checks.streaming.ok) return "unsupported";
  return checks.tools.ok && checks.jsonSchema.ok ? "full" : "degraded";
}

function explain(e: unknown): string {
  let text: string;
  if (isAuthError(e)) {
    const status = APICallError.isInstance(e) ? e.statusCode : undefined;
    text = `The provider rejected the API key (HTTP ${status ?? 401}).`;
  } else if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
    text = "Timed out after 60 seconds.";
  } else if (APICallError.isInstance(e)) {
    text = `HTTP ${e.statusCode ?? "?"}: ${e.message}`;
  } else {
    text = e instanceof Error ? e.message : String(e);
  }
  return text.slice(0, 200);
}

export async function probeCapabilities(
  deps: LlmDeps,
  target: ProbeTarget,
  opts?: { model?: (role: "main" | "fast") => LanguageModel },
): Promise<ProbeResult> {
  const build = (role: "main" | "fast") =>
    opts?.model?.(role) ??
    createLanguageModel(deps.config, target, role, "probe", { structuredOutputs: true });
  const main = build("main");
  const common = () => ({
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    instructions: INSTRUCTIONS,
  });
  const record = (
    role: "main" | "fast",
    u: { inputTokens?: number | undefined; outputTokens?: number | undefined },
  ) =>
    recordUsage(deps.db, {
      userId: target.userId,
      providerConfigId: target.id,
      model: target.models[role],
      role,
      purpose: "probe",
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
    });

  const basic = async (role: "main" | "fast", model: LanguageModel) => {
    const r = await generateText({
      model,
      prompt: "Reply with the single word: ready",
      ...common(),
    });
    await record(role, r.usage);
    if (!r.text.trim()) throw new Error("The model returned an empty reply.");
  };

  const streaming = async () => {
    let failure: unknown;
    const r = streamText({
      model: main,
      prompt: "Count from 1 to 5, separated by spaces.",
      onError: ({ error }) => {
        failure = error;
      },
      ...common(),
    });
    let chunks = 0;
    for await (const c of r.textStream) if (c.length > 0) chunks++;
    if (failure) throw failure;
    await record("main", await r.usage);
    if (chunks < 2) throw new Error("The reply arrived as a single chunk, not a stream.");
  };

  const tools = async () => {
    const r = await generateText({
      model: main,
      prompt: 'Call the echo tool with value "pathwise". Do not reply with text.',
      tools: {
        echo: tool({
          description: "Echoes a value back.",
          inputSchema: z.object({ value: z.string() }),
        }),
      },
      toolChoice: "auto",
      ...common(),
    });
    await record("main", r.usage);
    const called = r.toolCalls.some(
      (c) =>
        c.toolName === "echo" && (c.input as { value?: unknown } | undefined)?.value === "pathwise",
    );
    if (!called) throw new Error("The model replied without calling the tool.");
  };

  const jsonSchema = async () => {
    try {
      const r = await generateText({
        model: main,
        output: Output.object({
          schema: z.object({ city: z.string(), population: z.number().int() }),
        }),
        prompt: "Return JSON for the city Paris with its approximate population.",
        ...common(),
      });
      await record("main", r.usage);
      void r.output;
    } catch (e) {
      if (NoObjectGeneratedError.isInstance(e)) {
        await record("main", e.usage ?? {});
        throw new Error(`Structured output did not match the schema: ${e.message}`);
      }
      if (e instanceof NoOutputGeneratedError) {
        throw new Error(`Structured output did not match the schema: ${e.message}`);
      }
      throw e;
    }
  };

  let authRejected = false;
  const run = async (
    fn: () => Promise<void>,
    prefix = "",
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      await fn();
      return { ok: true };
    } catch (e) {
      if (isAuthError(e)) authRejected = true;
      return { ok: false, error: `${prefix}${explain(e)}`.slice(0, 200) };
    }
  };

  let checks: ProbeChecks;
  const basicResult = await run(() => basic("main", main));
  if (basicResult.ok) {
    checks = {
      basic: basicResult,
      streaming: await run(streaming),
      tools: await run(tools),
      jsonSchema: await run(jsonSchema),
    };
    if (target.models.fast !== target.models.main) {
      const fast = await run(() => basic("fast", build("fast")), "Fast model: ");
      if (!fast.ok) checks.basic = fast;
    }
  } else {
    const skipped = { ok: false, error: SKIPPED };
    checks = { basic: basicResult, streaming: skipped, tools: skipped, jsonSchema: skipped };
  }

  const ok = (name: ProbeCheckName) => checks[name].ok;
  return {
    checks,
    authRejected,
    status: statusFromChecks(checks),
    capabilities: {
      basic: ok("basic"),
      streaming: ok("streaming"),
      tools: ok("tools"),
      jsonSchema: ok("jsonSchema"),
      pdfInput: staticPdfInput(target.kind),
      contextWindow: contextWindowFor(target.kind, target.models.main, target.contextWindow),
    },
  };
}
