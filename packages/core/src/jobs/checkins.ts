import { z } from "zod";
import { mailerFor } from "../mail";
import { dispatchCheckins, followupCheckin, prepareCheckin } from "../services/checkins";
import { JOBS, type JobDeps } from "./queue";
import type { AnyJobDefinition, JobDefinition } from "./register";

// Standard policy on purpose (idempotency comes from the DB): ensureQueues deletes and recreates a
// queue whose policy changes, dropping pending jobs, so these must never change later.
const withMailer = (deps: JobDeps) => ({ ...deps, mailer: mailerFor(deps.config) });

const payload = z.object({ userId: z.string(), checkinId: z.uuid() });

const checkinDispatch: JobDefinition<Record<string, never>> = {
  name: JOBS.checkinDispatch,
  schema: z.object({}),
  cron: "*/15 * * * *",
  async handler(deps) {
    await dispatchCheckins(withMailer(deps));
  },
};

const checkinPrepare: JobDefinition<z.infer<typeof payload>> = {
  name: JOBS.checkinPrepare,
  schema: payload,
  async handler(deps, data) {
    await prepareCheckin(withMailer(deps), data);
  },
};

const checkinFollowup: JobDefinition<z.infer<typeof payload> & { stage: "nudge" | "final" }> = {
  name: JOBS.checkinFollowup,
  schema: payload.extend({ stage: z.enum(["nudge", "final"]) }),
  async handler(deps, data) {
    await followupCheckin(withMailer(deps), data);
  },
};

export const checkinJobs: AnyJobDefinition[] = [checkinDispatch, checkinPrepare, checkinFollowup];
