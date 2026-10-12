export class ConfigError extends Error {
  override name = "ConfigError";
}

export class ForbiddenError extends Error {
  override name = "ForbiddenError";
}

export class NotFoundError extends Error {
  override name = "NotFoundError";
}
