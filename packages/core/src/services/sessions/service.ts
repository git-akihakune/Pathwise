import { randomUUID } from "node:crypto";
import type { UIMessage } from "ai";
import { and, asc, desc, eq, gt, lt, type SQL, sql } from "drizzle-orm";
import { type DbOrTx, schema } from "../../db";
import { ConflictError, NotFoundError } from "../../errors";

const { sessions, messages } = schema;

export const SESSION_GAP_MS = 6 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ChatSession {
  id: string;
  startedAt: Date;
  lastMessageAt: Date;
  endedAt: Date | null;
  topic: string | null;
  summary: string | null;
  workflowRunId: string | null;
}

export interface SessionState extends ChatSession {
  curatedThroughMessageId: string | null;
  summarizedThroughMessageId: string | null;
}

export interface CoachMessageMetadata {
  sessionId: string;
  sessionStartedAt: string;
  topic: string | null;
  createdAt: string;
  status: "complete" | "interrupted";
}
export type CoachUIMessage = UIMessage<CoachMessageMetadata>;

type SessionRow = typeof sessions.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

function toSession(r: SessionRow): ChatSession {
  return {
    id: r.id,
    startedAt: r.startedAt,
    lastMessageAt: r.lastMessageAt,
    endedAt: r.endedAt,
    topic: r.topic,
    summary: r.summary,
    workflowRunId: r.workflowRunId,
  };
}

function toState(r: SessionRow): SessionState {
  return {
    ...toSession(r),
    curatedThroughMessageId: r.curatedThroughMessageId,
    summarizedThroughMessageId: r.summarizedThroughMessageId,
  };
}

function toUi(m: MessageRow, s: SessionRow): CoachUIMessage {
  return {
    id: m.id,
    role: m.role as "user" | "assistant",
    parts: m.parts as UIMessage["parts"],
    metadata: {
      sessionId: s.id,
      sessionStartedAt: s.startedAt.toISOString(),
      topic: s.topic,
      createdAt: m.createdAt.toISOString(),
      status: m.status as "complete" | "interrupted",
    },
  };
}

/** True unless every part is a `step-start` marker (an empty placeholder or failed-before-output reply). */
const nonEmpty = sql`exists (select 1 from jsonb_array_elements(${messages.parts}) e where e->>'type' <> 'step-start')`;

async function ownedSession(db: DbOrTx, userId: string, sessionId: string): Promise<SessionRow> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  if (!row) throw new NotFoundError("Session not found.");
  return row;
}

/**
 * The user's open session, or a new one after a gap of more than 6 h, or when a topic is given.
 * With `workflowRunId` only that run's session continues; free chat never continues a workflow session.
 */
export async function getOrStartSession(
  db: DbOrTx,
  userId: string,
  opts: { topic?: string; workflowRunId?: string; now?: Date } = {},
): Promise<ChatSession> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pathwise:session:${userId}`}))`);
    const [candidate] = await tx
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          sql`${sessions.endedAt} is null`,
          opts.workflowRunId
            ? eq(sessions.workflowRunId, opts.workflowRunId)
            : sql`${sessions.workflowRunId} is null`,
        ),
      )
      .orderBy(desc(sessions.lastMessageAt), desc(sessions.createdAt))
      .limit(1);
    if (
      candidate &&
      !opts.topic &&
      now.getTime() - candidate.lastMessageAt.getTime() <= SESSION_GAP_MS
    ) {
      return toSession(candidate);
    }
    if (candidate) {
      await tx
        .update(sessions)
        .set({ endedAt: candidate.lastMessageAt, updatedAt: sql`now()` })
        .where(eq(sessions.id, candidate.id));
    }
    const [created] = await tx
      .insert(sessions)
      .values({
        userId,
        startedAt: now,
        lastMessageAt: now,
        topic: opts.topic ?? null,
        workflowRunId: opts.workflowRunId ?? null,
      })
      .returning();
    return toSession(created as SessionRow);
  });
}

export async function getSessionState(
  db: DbOrTx,
  userId: string,
  sessionId: string,
): Promise<SessionState> {
  return toState(await ownedSession(db, userId, sessionId));
}

export async function appendMessage(
  db: DbOrTx,
  userId: string,
  sessionId: string,
  msg: {
    id?: string;
    role: "user" | "assistant";
    parts: UIMessage["parts"];
    status?: "complete" | "interrupted";
    inputTokens?: number;
    outputTokens?: number;
    skills?: string[];
    createdAt?: Date;
  },
): Promise<{ id: string }> {
  if (msg.id !== undefined && !UUID_RE.test(msg.id)) throw new Error("Message id must be a UUID");
  const id = msg.id ?? randomUUID();
  const createdAt = msg.createdAt ?? new Date();
  await db.transaction(async (tx) => {
    await ownedSession(tx, userId, sessionId);
    await tx.insert(messages).values({
      id,
      userId,
      sessionId,
      role: msg.role,
      parts: msg.parts,
      status: msg.status ?? "complete",
      inputTokens: msg.inputTokens ?? null,
      outputTokens: msg.outputTokens ?? null,
      skills: msg.skills ?? [],
      createdAt,
    });
    await tx
      .update(sessions)
      .set({ lastMessageAt: createdAt, updatedAt: sql`now()` })
      .where(eq(sessions.id, sessionId));
  });
  return { id };
}

/** Completes an assistant placeholder with its final parts and bumps the session's last activity. */
export async function finalizeMessage(
  db: DbOrTx,
  userId: string,
  id: string,
  patch: {
    parts: UIMessage["parts"];
    status: "complete" | "interrupted";
    inputTokens?: number;
    outputTokens?: number;
    skills?: string[];
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(messages)
      .set({
        parts: patch.parts,
        status: patch.status,
        inputTokens: patch.inputTokens ?? null,
        outputTokens: patch.outputTokens ?? null,
        ...(patch.skills ? { skills: patch.skills } : {}),
        updatedAt: sql`now()`,
      })
      .where(and(eq(messages.id, id), eq(messages.userId, userId)))
      .returning({ sessionId: messages.sessionId });
    if (!row) throw new NotFoundError("Message not found.");
    await tx
      .update(sessions)
      .set({ lastMessageAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(sessions.id, row.sessionId));
  });
}

export async function deleteMessage(db: DbOrTx, userId: string, id: string): Promise<void> {
  const rows = await db
    .delete(messages)
    .where(and(eq(messages.id, id), eq(messages.userId, userId)))
    .returning({ id: messages.id });
  if (rows.length === 0) throw new NotFoundError("Message not found.");
}

/**
 * Regenerate support: deletes every message after `userMessageId` in its session. Returns null when
 * the id is unknown, and a `ConflictError` when a later user message exists.
 */
export async function deleteRepliesAfter(
  db: DbOrTx,
  userId: string,
  userMessageId: string,
): Promise<{ sessionId: string } | null> {
  return db.transaction(async (tx) => {
    const [msg] = await tx
      .select({ sessionId: messages.sessionId, seq: messages.seq })
      .from(messages)
      .where(and(eq(messages.id, userMessageId), eq(messages.userId, userId)));
    if (!msg) return null;
    const later = and(eq(messages.sessionId, msg.sessionId), gt(messages.seq, msg.seq));
    const [newer] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(later, eq(messages.role, "user")))
      .limit(1);
    if (newer) throw new ConflictError("Only the latest message can be retried.");
    const [marks] = await tx
      .select({
        curated: sessions.curatedThroughMessageId,
        summarized: sessions.summarizedThroughMessageId,
      })
      .from(sessions)
      .where(eq(sessions.id, msg.sessionId))
      .for("update");
    const doomed = new Set(
      (await tx.select({ id: messages.id }).from(messages).where(later)).map((r) => r.id),
    );
    await tx.delete(messages).where(later);
    // ON DELETE SET NULL would reset the watermarks and re-process the whole session.
    const moved: Partial<typeof sessions.$inferInsert> = {};
    if (marks?.curated && doomed.has(marks.curated)) moved.curatedThroughMessageId = userMessageId;
    if (marks?.summarized && doomed.has(marks.summarized)) {
      moved.summarizedThroughMessageId = userMessageId;
    }
    if (Object.keys(moved).length > 0) {
      await tx.update(sessions).set(moved).where(eq(sessions.id, msg.sessionId));
    }
    return { sessionId: msg.sessionId };
  });
}

/** The newest `limit` non-empty messages of a session, oldest first. */
export async function recentMessages(
  db: DbOrTx,
  userId: string,
  sessionId: string,
  limit = 100,
): Promise<CoachUIMessage[]> {
  const rows = await db
    .select({ m: messages, s: sessions })
    .from(messages)
    .innerJoin(sessions, eq(sessions.id, messages.sessionId))
    .where(and(eq(messages.userId, userId), eq(messages.sessionId, sessionId), nonEmpty))
    .orderBy(desc(messages.seq))
    .limit(limit);
  return rows.reverse().map((r) => toUi(r.m, r.s));
}

/** Non-empty messages after a watermark (null = from the start), oldest first. */
export async function messagesAfter(
  db: DbOrTx,
  userId: string,
  sessionId: string,
  afterMessageId: string | null,
): Promise<CoachUIMessage[]> {
  const conds: (SQL | undefined)[] = [
    eq(messages.userId, userId),
    eq(messages.sessionId, sessionId),
    nonEmpty,
  ];
  if (afterMessageId) {
    conds.push(
      gt(
        messages.seq,
        sql`coalesce((select seq from ${messages} where id = ${afterMessageId} and session_id = ${sessionId}), 0)`,
      ),
    );
  }
  const rows = await db
    .select({ m: messages, s: sessions })
    .from(messages)
    .innerJoin(sessions, eq(sessions.id, messages.sessionId))
    .where(and(...conds))
    .orderBy(asc(messages.seq));
  return rows.map((r) => toUi(r.m, r.s));
}

/** The newest `limit` messages before `before`, grouped by session in chronological order. */
export async function listConversation(
  db: DbOrTx,
  userId: string,
  opts: { before?: Date; limit?: number } = {},
): Promise<{ session: ChatSession; messages: CoachUIMessage[] }[]> {
  const rows = await db
    .select({ m: messages, s: sessions })
    .from(messages)
    .innerJoin(sessions, eq(sessions.id, messages.sessionId))
    .where(
      and(
        eq(messages.userId, userId),
        nonEmpty,
        opts.before ? lt(messages.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(opts.limit ?? 50);
  const groups = new Map<string, { session: ChatSession; messages: CoachUIMessage[] }>();
  for (const r of rows.reverse()) {
    let g = groups.get(r.s.id);
    if (!g) {
      g = { session: toSession(r.s), messages: [] };
      groups.set(r.s.id, g);
    }
    g.messages.push(toUi(r.m, r.s));
  }
  return [...groups.values()];
}

/** Skills chosen for the last `turns` assistant messages of a session, oldest first. */
export async function recentSkills(
  db: DbOrTx,
  userId: string,
  sessionId: string,
  turns = 3,
): Promise<string[][]> {
  const rows = await db
    .select({ skills: messages.skills })
    .from(messages)
    .where(
      and(
        eq(messages.userId, userId),
        eq(messages.sessionId, sessionId),
        eq(messages.role, "assistant"),
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(turns);
  return rows.reverse().map((r) => r.skills);
}

/** Watermark updates only accept a message of the same session. */
async function setWatermark(
  db: DbOrTx,
  userId: string,
  sessionId: string,
  messageId: string,
  set: Partial<typeof sessions.$inferInsert>,
): Promise<void> {
  const rows = await db
    .update(sessions)
    .set({ ...set, updatedAt: sql`now()` })
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        sql`exists (select 1 from ${messages} where ${messages.id} = ${messageId} and ${messages.sessionId} = ${sessionId})`,
      ),
    )
    .returning({ id: sessions.id });
  if (rows.length === 0) throw new NotFoundError("Session or message not found.");
}

/** Stores the rolling summary and what it covers; the old summary's embedding is cleared. */
export async function setSessionSummary(
  db: DbOrTx,
  userId: string,
  sessionId: string,
  input: { summary: string; throughMessageId: string },
): Promise<void> {
  await setWatermark(db, userId, sessionId, input.throughMessageId, {
    summary: input.summary,
    summarizedThroughMessageId: input.throughMessageId,
    summaryEmbedding: null,
    summaryEmbeddingModel: null,
  });
}

export async function setCuratedThrough(
  db: DbOrTx,
  userId: string,
  sessionId: string,
  messageId: string,
): Promise<void> {
  await setWatermark(db, userId, sessionId, messageId, { curatedThroughMessageId: messageId });
}
