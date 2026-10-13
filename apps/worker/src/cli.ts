import { resetPassword } from "@pathwise/core/auth";
import { loadConfig } from "@pathwise/core/config";
import { rotateEncryptionKey } from "@pathwise/core/crypto";
import { createDb } from "@pathwise/core/db";
import { ConfigError, NotFoundError } from "@pathwise/core/errors";
import { pgBossQueue } from "@pathwise/core/jobs";
import { mailerFor } from "@pathwise/core/mail";
import { findUserIdByEmail, openCheckinNow } from "@pathwise/core/services/checkins";
import { PgBoss } from "pg-boss";
import { HEARTBEAT_PATH, isHeartbeatFresh } from "./heartbeat";

export interface CliIo {
  out: (s: string) => void;
  err: (s: string) => void;
}

const USAGE = `Usage: pathwise <command>

Commands:
  admin reset-password <email>   Set a new random password for a user
  admin rotate-encryption-key      Re-encrypt stored API keys with a new key
  checkin start <email>          Open this week's check-in for a user now
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
  if (a === "checkin" && b === "start" && email) {
    const config = loadConfig();
    const { db, pool } = createDb(config.databaseUrl);
    // Like the web's getBoss(): send-only, the worker owns schedules and `init` owns the schema.
    const boss = new PgBoss({
      connectionString: config.databaseUrl,
      supervise: false,
      schedule: false,
      migrate: false,
    });
    try {
      const userId = await findUserIdByEmail(db, email);
      if (!userId) {
        io.err(`No user with email ${email}.`);
        return 1;
      }
      await boss.start();
      const { opened, weekOf } = await openCheckinNow(
        { db, config, queue: pgBossQueue(boss), mailer: mailerFor(config) },
        userId,
      );
      io.out(
        opened
          ? `Opened check-in for ${email} (week of ${weekOf})`
          : `A check-in for the week of ${weekOf} already exists.`,
      );
      return 0;
    } finally {
      await boss.stop({ graceful: false }).catch(() => {});
      await pool.end();
    }
  }
  io.err(USAGE);
  return 2;
}
