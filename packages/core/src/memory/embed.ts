import { type SQL, sql } from "drizzle-orm";
import { embedTexts } from "../llm/generate";
import type { Llm, LlmDeps } from "../llm/types";

const BATCH = 64;

interface Pending {
  text: string;
  /** Writes the vector, guarded so a concurrent edit (which nulls the embedding) wins. */
  write(vec: string, model: string): SQL;
}

const stale = (model: string) =>
  sql`(embedding is null or embedding_model is distinct from ${model})`;

/** Embeds this user's unembedded or foreign-model memories, stories, and session summaries. Returns the count written. */
export async function embedPending(
  deps: LlmDeps,
  llm: Llm,
  userId: string,
): Promise<{ embedded: number }> {
  if (!llm.embedding) return { embedded: 0 };
  const { db } = deps;
  const model = llm.embedding.modelId;
  const pending: Pending[] = [];

  const memories = await db.execute<{ id: string; content: string; version: number }>(
    sql`select id, content, version from memory_items
        where user_id = ${userId} and status in ('active', 'pending') and ${stale(model)}`,
  );
  for (const m of memories.rows) {
    pending.push({
      text: m.content,
      write: (vec, mdl) =>
        sql`update memory_items set embedding = ${vec}::vector, embedding_model = ${mdl}
            where id = ${m.id} and version = ${m.version}`,
    });
  }
  const stories = await db.execute<{
    id: string;
    version: number;
    title: string;
    situation: string;
    task: string;
    action: string;
    result: string;
  }>(
    sql`select id, version, title, situation, task, action, result from stories
        where user_id = ${userId} and ${stale(model)}`,
  );
  for (const s of stories.rows) {
    pending.push({
      text: [s.title, s.situation, s.task, s.action, s.result].join("\n"),
      write: (vec, mdl) =>
        sql`update stories set embedding = ${vec}::vector, embedding_model = ${mdl}
            where id = ${s.id} and version = ${s.version}`,
    });
  }
  const sessions = await db.execute<{ id: string; summary: string; updated_at: string }>(
    sql`select id, summary, updated_at::text as updated_at from sessions
        where user_id = ${userId} and summary is not null
          and (summary_embedding is null or summary_embedding_model is distinct from ${model})`,
  );
  for (const s of sessions.rows) {
    pending.push({
      text: s.summary,
      write: (vec, mdl) =>
        sql`update sessions set summary_embedding = ${vec}::vector, summary_embedding_model = ${mdl}
            where id = ${s.id} and updated_at = ${s.updated_at}::timestamptz`,
    });
  }

  let embedded = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const vectors = await embedTexts(
      deps,
      llm,
      "embed.memory",
      batch.map((p) => p.text),
    );
    if (!vectors) return { embedded };
    for (const [j, p] of batch.entries()) {
      const v = vectors[j];
      if (!v) continue;
      const r = await db.execute(p.write(JSON.stringify(v), model));
      embedded += r.rowCount ?? 0;
    }
  }
  return { embedded };
}
