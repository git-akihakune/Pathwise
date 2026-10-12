export class ConfigError extends Error {
  override name = "ConfigError";
}

export class ForbiddenError extends Error {
  override name = "ForbiddenError";
}

export class NotFoundError extends Error {
  override name = "NotFoundError";
}

/** User-correctable input error. The message is user-facing copy. */
export class ValidationError extends Error {
  override name = "ValidationError";
}

export type LlmUnavailableReason = "none" | "auth_failed" | "unusable";

export class LlmUnavailableError extends Error {
  override name = "LlmUnavailableError";
  readonly reason: LlmUnavailableReason;
  constructor(reason: LlmUnavailableReason) {
    super(`No usable LLM provider (${reason}).`);
    this.reason = reason;
  }
}
