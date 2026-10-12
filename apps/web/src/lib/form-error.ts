import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@pathwise/core/errors";
import { createLogger } from "@pathwise/core/logger";
import { ZodError } from "zod";

const log = createLogger("web");

export const CONFLICT_MESSAGE = "This changed somewhere else. Reload to see the latest version.";
export const GONE_MESSAGE = "This item no longer exists. Reload the page.";

export type FormError = { error: string };

/**
 * Maps an error thrown by a core service to a form error. Core errors carry user-facing
 * messages; anything else is logged by name only (never the message, which may echo input)
 * and replaced with a generic message.
 */
export function toFormError(e: unknown, context: { configId?: string } = {}): FormError {
  if (e instanceof ValidationError || e instanceof ForbiddenError || e instanceof NotFoundError) {
    return { error: e.message };
  }
  if (e instanceof ZodError)
    return { error: e.issues[0]?.message ?? "Check the form and try again." };
  if (e instanceof ConflictError) return { error: CONFLICT_MESSAGE };
  log.error({ err: e instanceof Error ? e.name : typeof e, ...context }, "action failed");
  return { error: "Something went wrong. Check the server logs." };
}
