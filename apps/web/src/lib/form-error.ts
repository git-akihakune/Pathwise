import { ForbiddenError, NotFoundError, ValidationError } from "@pathwise/core/errors";
import { createLogger } from "@pathwise/core/logger";

const log = createLogger("web");

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
  log.error({ err: e instanceof Error ? e.name : typeof e, ...context }, "action failed");
  return { error: "Something went wrong. Check the server logs." };
}
