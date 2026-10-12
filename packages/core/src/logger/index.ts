import pino from "pino";

/** Content-free structured logger (spec §10): log identifiers and counts, never user content or secrets. */
export function createLogger(name: string): pino.Logger {
  return pino({ name, level: process.env.LOG_LEVEL || "info" });
}
