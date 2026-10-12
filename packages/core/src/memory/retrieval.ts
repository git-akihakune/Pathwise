import { type SQL, sql } from "drizzle-orm";
import { embedTexts } from "../llm/generate";
import type { Llm, LlmDeps } from "../llm/types";
import { createLogger } from "../logger";
import type { MemoryCategory } from "../services/memory";

const log = createLogger("memory");

export interface RetrievedItem {
  kind: "memory" | "story" | "session";
  id: string;
  text: string;
  category: MemoryCategory | null;
  createdAt: Date;
}

const CANDIDATES = 20;

/** Reciprocal rank fusion: score(id) = Σ 1 / (k + rank), ranks from 1. Ties keep first-seen order. */
export function rrfFuse(lists: { id: string }[][], k = 60): string[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, i) => {
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + i + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** An OR query over distinct words of 3+ letters, or null when there are none. */
export function toOrTsQuery(query: string): string | null {
  const words = [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 3),
    ),
  ].slice(0, 12);
  return words.length > 0 ? words.join(" | ") : null;
}

type Row = { id: string };
const ids = (kind: string, rows: Row[]) => rows.map((r) => ({ id: `${kind}:${r.id}` }));

export async function hybridSearch(
  deps: LlmDeps,
  llm: Llm | null,
  userId: string,
  query: string,
  opts: { limit?: number; excludeSessionId?: string } = {},
): Promise<RetrievedItem[]> {
  const { db } = deps;
  const limit = opts.limit ?? 12;
  const notExcluded = opts.excludeSessionId ? sql`and id <> ${opts.excludeSessionId}::uuid` : sql``;
  const run = async (kind: string, q: SQL) => ids(kind, (await db.execute<Row>(q)).rows);
  const lists: { id: string }[][] = [];

  const ts = toOrTsQuery(query);
  if (ts) {
    const tsq = sql`to_tsquery('english', ${ts})`;
    lists.push(
      await run(
        "memory",
        sql`select id from memory_items where user_id = ${userId} and status = 'active' and search @@ ${tsq}
            order by ts_rank_cd(search, ${tsq}) desc limit ${CANDIDATES}`,
      ),
      await run(
        "story",
        sql`select id from stories where user_id = ${userId} and search @@ ${tsq}
            order by ts_rank_cd(search, ${tsq}) desc limit ${CANDIDATES}`,
      ),
      await run(
        "session",
        sql`select id from sessions where user_id = ${userId} and summary is not null
            and summary_search @@ ${tsq} ${notExcluded}
            order by ts_rank_cd(summary_search, ${tsq}) desc limit ${CANDIDATES}`,
      ),
    );
  }

  if (llm?.embedding) {
    try {
      const vectors = await embedTexts(deps, llm, "embed.query", [query]);
      const v = vectors?.[0];
      if (v) {
        const vec = sql`${JSON.stringify(v)}::vector`;
        const model = llm.embedding.modelId;
        lists.push(
          await run(
            "memory",
            sql`select id from memory_items where user_id = ${userId} and status = 'active'
                and embedding is not null and embedding_model = ${model}
                order by embedding <=> ${vec} limit ${CANDIDATES}`,
          ),
          await run(
            "story",
            sql`select id from stories where user_id = ${userId}
                and embedding is not null and embedding_model = ${model}
                order by embedding <=> ${vec} limit ${CANDIDATES}`,
          ),
          await run(
            "session",
            sql`select id from sessions where user_id = ${userId} and summary is not null
                and summary_embedding is not null and summary_embedding_model = ${model} ${notExcluded}
                order by summary_embedding <=> ${vec} limit ${CANDIDATES}`,
          ),
        );
      }
    } catch (e) {
      // Full-text results still stand; auth failures are marked by the llm layer.
      log.warn({ userId, err: e instanceof Error ? e.name : "unknown" }, "query embedding failed");
    }
  }

  const top = rrfFuse(lists).slice(0, limit);
  const byKind = (kind: string) =>
    top.filter((t) => t.startsWith(`${kind}:`)).map((t) => t.slice(kind.length + 1));
  const items = new Map<string, RetrievedItem>();
  const load = async <R extends { id: string }>(
    kind: string,
    q: (idList: SQL) => SQL,
    map: (r: R) => RetrievedItem,
  ) => {
    const list = byKind(kind);
    if (list.length === 0) return;
    const idList = sql`array[${sql.join(
      list.map((i) => sql`${i}`),
      sql`, `,
    )}]::uuid[]`;
    for (const r of (await db.execute(q(idList))).rows as R[]) {
      items.set(`${kind}:${r.id}`, map(r));
    }
  };
  await load<{ id: string; content: string; category: MemoryCategory; created_at: Date }>(
    "memory",
    (l) =>
      sql`select id, content, category, created_at from memory_items where user_id = ${userId} and id = any(${l})`,
    (r) => ({
      kind: "memory",
      id: r.id,
      text: r.content,
      category: r.category,
      createdAt: new Date(r.created_at),
    }),
  );
  await load<{ id: string; title: string; action: string; result: string; created_at: Date }>(
    "story",
    (l) =>
      sql`select id, title, action, result, created_at from stories where user_id = ${userId} and id = any(${l})`,
    (r) => ({
      kind: "story",
      id: r.id,
      text: `${r.title}: ${r.action} → ${r.result}`,
      category: null,
      createdAt: new Date(r.created_at),
    }),
  );
  await load<{ id: string; summary: string; created_at: Date }>(
    "session",
    (l) =>
      sql`select id, summary, created_at from sessions where user_id = ${userId} and id = any(${l})`,
    (r) => ({
      kind: "session",
      id: r.id,
      text: r.summary,
      category: null,
      createdAt: new Date(r.created_at),
    }),
  );
  return top.flatMap((t) => items.get(t) ?? []);
}
