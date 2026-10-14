export const metadata = { title: "Plan" };

import { listPaths } from "@pathwise/core/services/paths";
import { getActivePlan, mondayOf } from "@pathwise/core/services/plan";
import { effectiveTimezone, getUserSettings } from "@pathwise/core/services/settings";
import { connection } from "next/server";
import { OpenFormProvider } from "@/components/entity-form";
import { PageHeader } from "@/components/page-header";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";
import { ActionsSection } from "./actions-section";
import { MilestonesSection } from "./milestones-section";
import { NewPlanForm, NorthStarSection } from "./north-star-section";
import { PathComparison } from "./path-comparison";

export default async function PlanPage() {
  await connection();
  const { userId } = await requireSession();
  const { db } = getServer();
  const [plan, paths, settings] = await Promise.all([
    getActivePlan(db, userId),
    listPaths(db, userId),
    getUserSettings(db, userId),
  ]);
  const thisWeek = mondayOf(new Date(), effectiveTimezone(settings));
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Plan"
        description="Give your direction a practical route, one milestone and one week at a time."
      />
      <OpenFormProvider>
        {plan ? (
          <>
            <NorthStarSection plan={plan} />
            <MilestonesSection planId={plan.id} items={plan.milestones} />
            <ActionsSection
              planId={plan.id}
              actions={plan.actions}
              milestones={plan.milestones}
              thisWeek={thisWeek}
            />
          </>
        ) : (
          <NewPlanForm paths={paths.filter((p) => p.status !== "dismissed")} />
        )}
      </OpenFormProvider>
      <PathComparison paths={paths} />
    </div>
  );
}
