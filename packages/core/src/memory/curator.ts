import { sql } from "drizzle-orm";
import { z } from "zod";
import { wrapData } from "../agent/context";
import { withUserLlm } from "../jobs/with-llm";
import { embedTexts, generateStructured } from "../llm/generate";
import type { Llm, LlmDeps } from "../llm/types";
import { createLogger } from "../logger";
import { addMemory, MEMORY_CATEGORIES, type MemoryCategory } from "../services/memory";
import { getActivePlan } from "../services/plan";
import { createProposal, listProposals } from "../services/proposals";
import { getSessionState, messagesAfter, setCuratedThrough } from "../services/sessions";
import { type StoryInput, storyInputSchema } from "../services/stories";
import { summarizeSession } from "./summarize";
import { renderTranscript } from "./transcript";

const log = createLogger("memory");

export const CURATE_IDLE_MS = 30 * 60 * 1000;
const COSINE_MATCH = 0.85;
const LEXEME_MATCH = 0.6;

export interface CurateReport {
  status: "done" | "not_idle" | "no_new_messages" | "no_provider";
  active: number;
  pending: number;
  superseded: number;
  duplicates: number;
  proposals: number;
}

const report = (status: CurateReport["status"], o: Partial<CurateReport> = {}): CurateReport => ({
  status,
  active: 0,
  pending: 0,
  superseded: 0,
  duplicates: 0,
  proposals: 0,
  ...o,
});

// Plain, transform-free and all-required (R5): replies are parsed against this, then each story
// is validated with storyInputSchema and each memory by addMemory.
const extractSchema = z.object({
  memories: z
    .array(
      z.object({
        category: z.enum(MEMORY_CATEGORIES),
        content: z.string().min(3).max(500),
        confidence: z.number().min(0).max(1),
        sensitive: z.boolean(),
      }),
    )
    .max(20),
  stories: z
    .array(
      z.object({
        title: z.string(),
        situation: z.string(),
        task: z.string(),
        action: z.string(),
        result: z.string(),
        metrics: z.string().nullable(),
        skills: z.array(z.string()),
      }),
    )
    .max(5),
  actionUpdates: z
    .array(z.object({ actionId: z.string(), status: z.enum(["done", "skipped"]) }))
    .max(10),
});

const EXTRACT_INSTRUCTIONS = `Extract durable facts about the user from this coaching conversation.
Memory categories: value, constraint, aspiration, energizer, drain, preference, fact, event, observation.
Mark a memory sensitive when it concerns health, immigration or visa status, finances, family or relationship matters, protected characteristics (religion, ethnicity, sexuality, disability, age), criminal history, or a current employer conflict.
Only what the user said about themselves; confidence reflects how clearly they said it.
stories: concrete achievements the user described, as situation, task, action, result.
actionUpdates: plan actions the user said they finished (done) or are dropping (skipped), by the listed id.
Return empty lists when there is nothing.`;

const dedupeSchema = z.object({ decision: z.enum(["duplicate", "update", "new"]) });

interface Candidate {
  category: MemoryCategory;
  content: string;
  confidence: number;
  sensitive: boolean;
}
type NearMatch = { id: string; status: string; content: string };

const fold = (s: string) => s.trim().toLowerCase();

async function nearMatch(
  deps: LlmDeps,
  llm: Llm,
  userId: string,
  c: Candidate,
  vector: number[] | null,
): Promise<NearMatch | null> {
  const { db } = deps;
  if (vector && llm.embedding) {
    const v = JSON.stringify(vector);
    const r = await db.execute<NearMatch & { sim: number }>(
      sql`select id, status, content, 1 - (embedding <=> ${v}::vector) as sim from memory_items
          where user_id = ${userId} and status in ('active', 'pending')
            and embedding is not null and embedding_model = ${llm.embedding.modelId}
          order by embedding <=> ${v}::vector limit 1`,
    );
    const top = r.rows[0];
    return top && Number(top.sim) >= COSINE_MATCH ? top : null;
  }
  const r = await db.execute<NearMatch & { overlap: number }>(
    sql`with q as (select tsvector_to_array(to_tsvector('english', ${c.content})) as a)
        select m.id, m.status, m.content,
          cardinality(array(select unnest(tsvector_to_array(m.search)) intersect select unnest(q.a)))::float
            / greatest(least(cardinality(tsvector_to_array(m.search)), cardinality(q.a)), 1) as overlap
        from memory_items m, q
        where m.user_id = ${userId} and m.status in ('active', 'pending')
        order by overlap desc limit 1`,
  );
  const top = r.rows[0];
  return top && Number(top.overlap) >= LEXEME_MATCH ? top : null;
}

/**
 * Turns the session's new messages into memories (routed by sensitivity and confidence), story and
 * action-status Proposals, and a final summary. Runs only once the session has been idle for 30 min.
 */
export async function curateSession(
  deps: LlmDeps,
  userId: string,
  sessionId: string,
): Promise<CurateReport> {
  const { db } = deps;
  const state = await getSessionState(db, userId, sessionId);
  if (Date.now() - state.lastMessageAt.getTime() < CURATE_IDLE_MS) return report("not_idle");
  const msgs = await messagesAfter(db, userId, sessionId, state.curatedThroughMessageId);
  const lastMsg = msgs[msgs.length - 1];
  if (!lastMsg) return report("no_new_messages");

  let result: CurateReport | null = null;
  const outcome = await withUserLlm(deps, userId, async (llm) => {
    const plan = await getActivePlan(db, userId);
    const actions = plan?.actions ?? [];
    const actionLines = actions.map((a) => `${a.id} | ${a.title} | ${a.status} | week ${a.weekOf}`);

    // All LLM calls happen before the transaction opens.
    const extracted = await generateStructured(deps, llm, {
      role: "fast",
      purpose: "curate.extract",
      instructions: EXTRACT_INSTRUCTIONS,
      prompt: `${wrapData("transcript", renderTranscript(msgs))}\n${wrapData("plan-actions", actionLines.join("\n") || "none")}`,
      schema: extractSchema,
    });

    let duplicates = 0;
    const proposed = new Set(
      (await listProposals(db, userId, { sessionId }))
        .filter((p) => p.kind === "memory_add")
        .map((p) => fold((p.payload as { content: string }).content)),
    );
    const seen = new Set<string>();
    const candidates: Candidate[] = [];
    for (const m of extracted.memories) {
      const key = fold(m.content);
      if (proposed.has(key) || seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      candidates.push({ ...m, content: m.content.trim() });
    }

    const vectors =
      candidates.length > 0
        ? await embedTexts(
            deps,
            llm,
            "embed.curate",
            candidates.map((c) => c.content),
          )
        : null;

    const plans: { c: Candidate; supersedesId?: string }[] = [];
    const used = new Set<string>();
    for (const [i, c] of candidates.entries()) {
      const match = await nearMatch(deps, llm, userId, c, vectors?.[i] ?? null);
      if (!match) {
        plans.push({ c });
        continue;
      }
      const { decision } = await generateStructured(deps, llm, {
        role: "fast",
        purpose: "curate.dedupe",
        instructions:
          "Compare a new statement with a stored memory about the same user. Answer duplicate if the stored memory already says the same, update if the new statement replaces or refines it, new if it is a different fact.",
        prompt: `${wrapData("stored", match.content)}\n${wrapData("new", c.content)}`,
        schema: dedupeSchema,
      });
      // A pending match is treated as a duplicate (R9): only active items can be superseded.
      if (decision === "duplicate" || (decision === "update" && match.status !== "active")) {
        duplicates++;
      } else if (decision === "update" && !used.has(match.id)) {
        used.add(match.id);
        plans.push({ c, supersedesId: match.id });
      } else {
        plans.push({ c });
      }
    }

    const stories: StoryInput[] = [];
    for (const s of extracted.stories) {
      const parsed = storyInputSchema.safeParse(s);
      if (parsed.success) stories.push(s);
    }
    const byId = new Map(actions.map((a) => [a.id, a]));
    const updates = extracted.actionUpdates.flatMap((u) => {
      const a = byId.get(u.actionId);
      return a && a.status !== u.status
        ? [{ actionId: a.id, status: u.status, basedOnVersion: a.version }]
        : [];
    });

    const out = report("done", { duplicates });
    await db.transaction(async (tx) => {
      for (const { c, supersedesId } of plans) {
        const active = !c.sensitive && c.confidence >= 0.8;
        await addMemory(tx, userId, {
          category: c.category,
          content: c.content,
          sourceType: "message",
          sourceId: sessionId,
          confidence: c.confidence,
          sensitive: c.sensitive,
          status: active ? "active" : "pending",
          ...(supersedesId && { supersedesId }),
        });
        if (active) {
          out.active++;
          if (supersedesId) out.superseded++;
        } else out.pending++;
      }
      for (const s of stories) {
        await createProposal(tx, userId, { kind: "story_add", payload: s, sessionId });
        out.proposals++;
      }
      if (updates.length > 0) {
        await createProposal(tx, userId, {
          kind: "action_status_update",
          payload: { updates },
          sessionId,
        });
        out.proposals++;
      }
      await setCuratedThrough(tx, userId, sessionId, lastMsg.id);
    });
    result = out;

    // The session's embedding is refreshed by the next maintenance tick.
    await summarizeSession(deps, llm, userId, sessionId, { keepLast: 0 });
  });
  if (result) return result;
  log.info({ userId, sessionId, outcome }, "curation skipped");
  return report("no_provider");
}
