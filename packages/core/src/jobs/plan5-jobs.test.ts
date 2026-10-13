// packages/core/src/jobs/plan5-jobs.test.ts
import { expect, it } from "vitest";
import { coreJobs } from ".";

it("registers the Plan 5 jobs", () => {
  const byName = Object.fromEntries(coreJobs.map((j) => [j.name, j]));
  expect(byName["checkin.dispatch"]?.cron).toBe("*/15 * * * *");
  for (const n of ["document.parse", "checkin.prepare", "checkin.followup"])
    expect(byName[n]).toBeDefined();
});
