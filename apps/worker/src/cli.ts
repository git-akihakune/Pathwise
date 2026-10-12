import { resetPassword } from "@pathwise/core/auth";
import { loadConfig } from "@pathwise/core/config";
import { rotateEncryptionKey } from "@pathwise/core/crypto";
import { createDb } from "@pathwise/core/db";
import { ConfigError, NotFoundError } from "@pathwise/core/errors";
import { HEARTBEAT_PATH, isHeartbeatFresh } from "./heartbeat";

export interface CliIo {
  out: (s: string) => void;
  err: (s: string) => void;
}

const USAGE = `Usage: pathwise <command>

Commands:
  admin reset-password <email>   Set a new random password for a user
  admin rotate-encryption-key      Re-encrypt stored API keys with a new key
  healthcheck                    Exit 0 if the worker heartbeat is fresh`;

const defaultIo: CliIo = {
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
};

export async function runCli(args: string[], io: CliIo = defaultIo): Promise<number> {
  const [a, b, email] = args;
  if (a === "healthcheck") return isHeartbeatFresh(HEARTBEAT_PATH) ? 0 : 1;
  if (a === "admin" && b === "reset-password" && email) {
    const { db, pool } = createDb(loadConfig().databaseUrl);
    try {
      // The password goes to the operator's stdout only, never the logger.
      io.out(`New password for ${email}: ${await resetPassword(db, email)}`);
      return 0;
    } catch (e) {
      if (e instanceof NotFoundError) {
        io.err(e.message);
        return 1;
      }
      throw e;
    } finally {
      await pool.end();
    }
  }
  if (a === "admin" && b === "rotate-encryption-key") {
    const config = loadConfig();
    const { db, pool } = createDb(config.databaseUrl);
    try {
      const { rotated } = await rotateEncryptionKey(db, config, process.env);
      io.out(`Re-encrypted ${rotated} provider keys.`);
      io.out("Restart web and worker to use the new key: docker compose restart web worker");
      return 0;
    } catch (e) {
      if (e instanceof ConfigError) {
        io.err(e.message);
        return 1;
      }
      throw e;
    } finally {
      await pool.end();
    }
  }
  io.err(USAGE);
  return 2;
}
