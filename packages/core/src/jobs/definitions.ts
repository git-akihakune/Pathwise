import { z } from "zod";
import { embedPending } from "../memory/embed";
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

/** Task 10 (and Plan 5) append their definitions. */
export const coreJobs: AnyJobDefinition[] = [maintenanceTick, memoryEmbed];
