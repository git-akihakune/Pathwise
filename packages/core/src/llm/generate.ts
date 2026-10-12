import {
  embedMany,
  generateText,
  type ModelMessage,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from "ai";
import { z } from "zod";
import { createLogger } from "../logger";
import { isAuthError, markAuthFailed } from "./auth";
import { estimateTokens } from "./tokens";
import type { Llm, LlmDeps, LlmPurpose } from "./types";
import { recordUsage } from "./usage";

const log = createLogger("llm");

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    public issues: string[],
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

export function parseJsonReply<T>(
  text: string,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false; issues: string[] } {
  let body = text.trim();
  const fence = body.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fence) {
    body = (fence[1] ?? "").trim();
  } else if (!body.startsWith("{") && !body.startsWith("[")) {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start !== -1 && end > start) body = body.slice(start, end + 1);
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return { ok: false, issues: [`Reply is not valid JSON: ${(e as Error).message}`] };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

interface CallOpts {
  role: "main" | "fast";
  purpose: LlmPurpose;
  instructions: string;
  prompt?: string;
  messages?: ModelMessage[];
}

interface Usage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
}

function messagesText(messages: ModelMessage[] | undefined): string {
  return (messages ?? [])
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");
}

async function record(
  { db }: LlmDeps,
  llm: Llm,
  o: CallOpts,
  usage: Usage,
  outputText: string,
): Promise<void> {
  await recordUsage(db, {
    userId: llm.userId,
    providerConfigId: llm.providerConfigId,
    model: llm.modelId(o.role) ?? "unknown",
    role: o.role,
    purpose: o.purpose,
    inputTokens:
      usage.inputTokens ??
      estimateTokens(`${o.instructions}${o.prompt ?? ""}${messagesText(o.messages)}`),
    outputTokens: usage.outputTokens ?? estimateTokens(outputText),
  });
}

async function withAuthHandling<R>(
  { db }: LlmDeps,
  configId: string,
  fn: () => Promise<R>,
): Promise<R> {
  try {
    return await fn();
  } catch (e) {
    if (isAuthError(e)) await markAuthFailed(db, configId);
    throw e;
  }
}

export async function generateTextFor(deps: LlmDeps, llm: Llm, o: CallOpts): Promise<string> {
  return withAuthHandling(deps, llm.providerConfigId, async () => {
    const result = await generateText({
      model: llm.model(o.role, o.purpose),
      instructions: o.instructions,
      ...(o.messages ? { messages: o.messages } : { prompt: o.prompt ?? "" }),
    });
    await record(deps, llm, o, result.usage, result.text);
    return result.text;
  });
}

export async function generateStructured<T>(
  deps: LlmDeps,
  llm: Llm,
  o: CallOpts & { schema: z.ZodType<T> },
): Promise<T> {
  const native = llm.capabilities.jsonSchema;
  const instructions = native
    ? o.instructions
    : `${o.instructions}\n\nRespond with only a JSON object that matches this JSON Schema. Do not add prose or code fences.\n<json-schema>\n${JSON.stringify(z.toJSONSchema(o.schema), null, 2)}\n</json-schema>`;
  const callOpts: CallOpts = { ...o, instructions };
  const base: ModelMessage[] = o.messages ?? [{ role: "user", content: o.prompt ?? "" }];

  const attempt = async (
    messages: ModelMessage[],
  ): Promise<{ ok: true; value: T } | { ok: false; issues: string[]; text: string }> => {
    const input = { ...callOpts, messages };
    try {
      const result = await generateText({
        model: llm.model(o.role, o.purpose),
        instructions,
        messages,
        ...(native ? { output: Output.object({ schema: o.schema }) } : {}),
      });
      await record(deps, llm, input, result.usage, result.text);
      if (native) {
        try {
          return { ok: true, value: result.output as T };
        } catch (e) {
          if (!NoOutputGeneratedError.isInstance(e) && !NoObjectGeneratedError.isInstance(e))
            throw e;
          const parsed = parseJsonReply(result.text, o.schema);
          return parsed.ok ? parsed : { ...parsed, text: result.text };
        }
      }
      const parsed = parseJsonReply(result.text, o.schema);
      return parsed.ok ? parsed : { ...parsed, text: result.text };
    } catch (e) {
      if (NoObjectGeneratedError.isInstance(e)) {
        const text = e.text ?? "";
        await record(
          deps,
          llm,
          input,
          { inputTokens: e.usage?.inputTokens, outputTokens: e.usage?.outputTokens },
          text,
        );
        const parsed = parseJsonReply(text, o.schema);
        return parsed.ok ? parsed : { ...parsed, text };
      }
      throw e;
    }
  };

  return withAuthHandling(deps, llm.providerConfigId, async () => {
    const first = await attempt(base);
    if (first.ok) return first.value;
    log.warn(
      { purpose: o.purpose, role: o.role, providerConfigId: llm.providerConfigId, attempt: 1 },
      "structured output invalid, repairing",
    );
    const second = await attempt([
      ...base,
      // Anthropic and Google reject empty assistant content.
      ...(first.text.trim() ? [{ role: "assistant" as const, content: first.text }] : []),
      {
        role: "user",
        content: `Your previous reply did not match the required JSON.\nProblems:\n${first.issues.map((i) => `- ${i}`).join("\n")}\nReply with only the corrected JSON object.`,
      },
    ]);
    if (second.ok) return second.value;
    log.warn(
      { purpose: o.purpose, role: o.role, providerConfigId: llm.providerConfigId, attempt: 2 },
      "structured output invalid after repair",
    );
    throw new StructuredOutputError("Structured output invalid after one repair", second.issues);
  });
}

export async function embedTexts(
  deps: LlmDeps,
  llm: Llm,
  purpose: LlmPurpose,
  values: string[],
): Promise<number[][] | null> {
  const emb = llm.embedding;
  if (!emb) return null;
  return withAuthHandling(deps, emb.providerConfigId, async () => {
    const { embeddings, usage } = await embedMany({ model: emb.model, values });
    await recordUsage(deps.db, {
      userId: llm.userId,
      providerConfigId: emb.providerConfigId,
      model: emb.modelId,
      role: "embedding",
      purpose,
      inputTokens: usage.tokens,
      outputTokens: 0,
    });
    return embeddings;
  });
}
