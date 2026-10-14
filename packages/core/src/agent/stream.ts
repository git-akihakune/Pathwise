import type { ToolExecutionOptions, ToolSet, UIMessage, UIMessageStreamWriter } from "ai";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { StructuredOutputError } from "../llm/generate";
import { createLogger } from "../logger";

const log = createLogger("agent");

const FIRST_OUTPUT = new Set([
  "text-delta",
  "reasoning-delta",
  "tool-input-start",
  "tool-call",
  "error",
  "finish",
]);

/**
 * Buffers a stream up to its first output (or error, or finish) part. `early` is the error when that
 * part is an error, i.e. the request failed before anything reached the user. `stream` replays
 * every part, buffered ones first.
 */
export async function peekForEarlyError<T extends { type: string }>(
  s: ReadableStream<T>,
): Promise<{ early: unknown; stream: ReadableStream<T> }> {
  const reader = s.getReader();
  const buffered: T[] = [];
  let early: unknown;
  let done = false;
  while (true) {
    const r = await reader.read();
    if (r.done) {
      done = true;
      break;
    }
    buffered.push(r.value);
    if (FIRST_OUTPUT.has(r.value.type)) {
      if (r.value.type === "error") early = (r.value as { error?: unknown }).error;
      break;
    }
  }
  const stream = new ReadableStream<T>({
    start(c) {
      for (const p of buffered) c.enqueue(p);
      if (done) c.close();
    },
    async pull(c) {
      const r = await reader.read();
      if (r.done) c.close();
      else c.enqueue(r.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return { early, stream };
}

/**
 * Wraps tool executes so invalid generated output (StructuredOutputError) is surfaced to the model
 * once, then to the user (§9). `state.failures` counts them; the caller stops the loop at 2.
 */
export function guardTools(tools: ToolSet, state: { failures: number }): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => {
      const execute = t.execute;
      if (!execute) return [name, t];
      const guarded = async (input: unknown, opts: ToolExecutionOptions<unknown>) => {
        try {
          return await execute(input, opts);
        } catch (e) {
          if (!(e instanceof StructuredOutputError)) throw e;
          state.failures++;
          throw new ValidationError(
            state.failures === 1
              ? `The generated result was invalid (${e.issues.join("; ")}). You may try once more.`
              : "I couldn't produce a valid result. Try again, or rephrase your request.",
          );
        }
      };
      return [name, { ...t, execute: guarded }];
    }),
  ) as ToolSet;
}

/** Writes a complete one-part text reply (after the caller's `start` chunk). */
export function writeText<M extends UIMessage>(
  writer: UIMessageStreamWriter<M>,
  text: string,
): void {
  const id = "text-0";
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: text });
  writer.write({ type: "text-end", id });
  writer.write({ type: "finish" });
}

const USER_FACING = [
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  StructuredOutputError,
];

/**
 * Text for a tool error part (shown in the tool card and stored). Domain errors carry user copy;
 * anything else (e.g. a failed query with its SQL) gets a generic message.
 */
export function toolErrorText(e: unknown): string {
  if (typeof e === "string") return e; // the SDK's own invalid-tool-call messages
  if (USER_FACING.some((c) => e instanceof c)) return (e as Error).message;
  log.warn({ err: e instanceof Error ? e.name : typeof e }, "tool failed");
  return "That didn't work. Please try again.";
}
