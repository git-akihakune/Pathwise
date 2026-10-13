import "server-only";
import { getActivePlan } from "@pathwise/core/services/plan";
import { listProposals, type Proposal } from "@pathwise/core/services/proposals";
import { type CoachUIMessage, listConversation } from "@pathwise/core/services/sessions";
import type { ProposalView } from "@/components/proposal-card";
import { getServer } from "@/lib/server";

export const PAGE_SIZE = 50;

const NEEDS_TITLES = new Set<Proposal["kind"]>(["plan_change", "action_status_update"]);

/** Card data for proposals; plan proposals carry ids only, so they get the active plan's titles. */
export async function toProposalViews(userId: string, proposals: Proposal[]) {
  const plan = proposals.some((p) => NEEDS_TITLES.has(p.kind))
    ? await getActivePlan(getServer().db, userId)
    : null;
  const titles = Object.fromEntries(
    [...(plan?.milestones ?? []), ...(plan?.actions ?? [])].map((x) => [x.id, x.title]),
  );
  return proposals.map(
    ({ id, kind, payload, status }): ProposalView => ({
      id,
      kind,
      payload,
      status,
      ...(NEEDS_TITLES.has(kind) ? { titles } : {}),
    }),
  );
}

/** A page of the conversation (newest PAGE_SIZE messages before `before`) with its proposals. */
export async function loadHistory(
  userId: string,
  before?: Date,
): Promise<{
  messages: CoachUIMessage[];
  proposals: Record<string, ProposalView>;
  hasMore: boolean;
}> {
  const { db } = getServer();
  const groups = await listConversation(db, userId, { before, limit: PAGE_SIZE });
  const lists = await Promise.all(
    groups.map((g) => listProposals(db, userId, { sessionId: g.session.id })),
  );
  const views = await toProposalViews(userId, lists.flat());
  const messages = groups.flatMap((g) => g.messages);
  return {
    messages,
    proposals: Object.fromEntries(views.map((v) => [v.id, v])),
    hasMore: messages.length === PAGE_SIZE,
  };
}
