import { z } from "zod";
import { JOBS } from "./queue";
import type { AnyJobDefinition, JobDefinition } from "./register";
import { findMaintenanceWork } from "./tick";

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

/** Tasks 5 and 10 (and Plan 5) append their definitions. */
export const coreJobs: AnyJobDefinition[] = [maintenanceTick];
