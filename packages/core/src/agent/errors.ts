import { APICallError, RetryError, StreamProviderError } from "ai";
import { isAuthError } from "../llm/auth";

const CONTEXT_LENGTH =
  /context length|context size|too long|maximum number of tokens|exceeds the (maximum|available)/i;

/** A provider's "prompt exceeds the context window" rejection. */
export function isContextLengthError(e: unknown): boolean {
  if (!APICallError.isInstance(e)) return false;
  if (e.statusCode !== 400 && e.statusCode !== 413) return false;
  return CONTEXT_LENGTH.test(`${e.message} ${e.responseBody ?? ""}`);
}

function statusOf(e: unknown): number | undefined {
  if (APICallError.isInstance(e) || StreamProviderError.isInstance(e)) return e.statusCode;
  if (RetryError.isInstance(e)) return statusOf(e.lastError);
  return undefined;
}

/** User-facing copy for a chat failure (§9). */
export function chatErrorMessage(e: unknown, o: { afterContextRetry?: boolean } = {}): string {
  if (isAuthError(e)) return "Your API key was rejected. Update it in Settings.";
  if (o.afterContextRetry && isContextLengthError(e)) {
    return "This conversation is too long for the model. Start a new session to continue.";
  }
  const status = statusOf(e);
  if (status === 429) return "The AI provider is rate-limiting requests. Wait a moment and retry.";
  if (status !== undefined && status >= 500) {
    return "The AI provider had a problem. Retry in a moment.";
  }
  return "Something went wrong. Retry in a moment.";
}
