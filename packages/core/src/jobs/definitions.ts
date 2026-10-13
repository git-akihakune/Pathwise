import { z } from "zod";
import { curateSession } from "../memory/curator";
import { embedPending } from "../memory/embed";
import { refreshSnapshot } from "../memory/snapshot";
import { summarizeSession } from "../memory/summarize";
import { documentParseJob } from "./documents";
import { JOBS } from "./queue";
import type { AnyJobDefinition, JobDefinition } from "./register";
import { findMaintenanceWork } from "./tick";
import { withUserLlm } from "./with-llm";

const maintenanceTick: JobDefinition<Record<string, never>> = {
  name: JOBS.maintenanceTick,
  schema: z.object({}),
  cron: "* * * * *",
  async handler(deps) {
    const { snapshot, embed } = await findMaintenanceWork(deps.db);
    for (const userId of snapshot) {
      await deps.queue.send(JOBS.snapshotRefresh, { userId }, { singletonKey: userId });
    }
    for (const userId of embed) {
      await deps.queue.send(JOBS.memoryEmbed, { userId }, { singletonKey: userId });
    }
  },
};

const memoryEmbed: JobDefinition<{ userId: string }> = {
  name: JOBS.memoryEmbed,
  policy: "stately",
  schema: z.object({ userId: z.string() }),
  async handler(deps, { userId }) {
    await withUserLlm(deps, userId, (llm) => embedPending(deps, llm, userId).then(() => {}));
  },
};

const sessionPayload = z.object({ userId: z.string(), sessionId: z.string() });

const sessionCurate: JobDefinition<z.infer<typeof sessionPayload>> = {
  name: JOBS.sessionCurate,
  schema: sessionPayload,
  async handler(deps, { userId, sessionId }) {
    await curateSession(deps, userId, sessionId);
  },
};

const sessionSummarize: JobDefinition<z.infer<typeof sessionPayload>> = {
  name: JOBS.sessionSummarize,
  policy: "stately",
  schema: sessionPayload,
  async handler(deps, { userId, sessionId }) {
    await withUserLlm(deps, userId, async (llm) => {
      await summarizeSession(deps, llm, userId, sessionId, { keepLast: 4 });
    });
  },
};

const snapshotRefreshJob: JobDefinition<{ userId: string }> = {
  name: JOBS.snapshotRefresh,
  policy: "stately",
  schema: z.object({ userId: z.string() }),
  async handler(deps, { userId }) {
    await refreshSnapshot(deps, userId);
  },
};

/** Plan 5 appends its definitions. */
export const coreJobs: AnyJobDefinition[] = [
  maintenanceTick,
  memoryEmbed,
  sessionCurate,
  sessionSummarize,
  snapshotRefreshJob,
  documentParseJob,
];
