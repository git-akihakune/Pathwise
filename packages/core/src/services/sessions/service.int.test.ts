import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { seedUser } from "../../../../../test/integration/fixtures";
import { ConflictError, NotFoundError } from "../../errors";
import { createProposal, listProposals } from "../proposals";
import {
  appendMessage,
  deleteMessage,
  deleteRepliesAfter,
  finalizeMessage,
  getOrStartSession,
  getSessionState,
  listConversation,
  messagesAfter,
  recentMessages,
  recentSkills,
  setCuratedThrough,
  setSessionSummary,
} from "./service";

const db = getTestDb();
const H = 3_600_000;
const text = (t: string) => [{ type: "text" as const, text: t }];
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  await seedUser(db, "u2");
});

describe("getOrStartSession", () => {
  it("reuses the open session within 6 h and starts a new one after a longer gap", async () => {
    const s1 = await getOrStartSession(db, "u1");
    await appendMessage(db, "u1", s1.id, { role: "user", parts: text("hi") });
    expect(
      (await getOrStartSession(db, "u1", { now: new Date(Date.now() + 6 * H - 60_000) })).id,
    ).toBe(s1.id);
    const s2 = await getOrStartSession(db, "u1", { now: new Date(Date.now() + 6 * H + 60_000) });
    expect(s2.id).not.toBe(s1.id);
    expect((await getSessionState(db, "u1", s1.id)).endedAt).toBeInstanceOf(Date);
  });
  it("starts a focused session for a topic and keeps using it", async () => {
    const free = await getOrStartSession(db, "u1");
    const focused = await getOrStartSession(db, "u1", { topic: "Salary talk" });
    expect(focused).toMatchObject({ topic: "Salary talk" });
    expect(focused.id).not.toBe(free.id);
    expect((await getOrStartSession(db, "u1")).id).toBe(focused.id);
  });
  it("never continues a workflow session in free chat", async () => {
    const runId = "00000000-0000-4000-8000-000000000001";
    const wf = await getOrStartSession(db, "u1", { workflowRunId: runId });
    expect((await getOrStartSession(db, "u1", { workflowRunId: runId })).id).toBe(wf.id);
    expect((await getOrStartSession(db, "u1")).id).not.toBe(wf.id);
  });
  it("returns one session for concurrent first messages", async () => {
    const [a, b] = await Promise.all([getOrStartSession(db, "u1"), getOrStartSession(db, "u1")]);
    expect(a.id).toBe(b.id);
  });
});

describe("messages", () => {
  it("round-trips parts with metadata, in order, hiding empty placeholders", async () => {
    const s = await getOrStartSession(db, "u1");
    const u = await appendMessage(db, "u1", s.id, {
      role: "user",
      parts: text("Find nursing roles"),
    });
    const tool = {
      type: "tool-getOccupation",
      toolCallId: "c1",
      state: "output-available",
      input: { idOrCode: "29-1141.00" },
      output: { title: "Registered Nurses" },
    };
    await appendMessage(db, "u1", s.id, {
      role: "assistant",
      parts: [tool, ...text("Here.")] as UIMessage["parts"],
      skills: ["core", "direction"],
    });
    await appendMessage(db, "u1", s.id, { role: "assistant", parts: [], status: "interrupted" });
    const msgs = await recentMessages(db, "u1", s.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[0]?.id).toBe(u.id);
    expect(msgs[1]?.parts[0]).toEqual(tool);
    expect(msgs[1]?.metadata).toMatchObject({ sessionId: s.id, status: "complete", topic: null });
    expect(await recentSkills(db, "u1", s.id)).toEqual([["core", "direction"], []]);
  });
  it("rejects non-UUID ids and other users' sessions", async () => {
    const s = await getOrStartSession(db, "u1");
    await expect(
      appendMessage(db, "u1", s.id, { id: "msg_1", role: "user", parts: text("x") }),
    ).rejects.toThrow(/UUID/);
    await expect(
      appendMessage(db, "u2", s.id, { role: "user", parts: text("x") }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await recentMessages(db, "u2", s.id)).toEqual([]);
  });
  it("groups the conversation by session, oldest first", async () => {
    const s1 = await getOrStartSession(db, "u1");
    await appendMessage(db, "u1", s1.id, { role: "user", parts: text("one") });
    const s2 = await getOrStartSession(db, "u1", { topic: "Focus" });
    await appendMessage(db, "u1", s2.id, { role: "user", parts: text("two") });
    const groups = await listConversation(db, "u1");
    expect(groups.map((g) => [g.session.id, g.messages.length])).toEqual([
      [s1.id, 1],
      [s2.id, 1],
    ]);
  });
  it("regenerating deletes later replies and keeps their proposals pending", async () => {
    const s = await getOrStartSession(db, "u1");
    const u = await appendMessage(db, "u1", s.id, { role: "user", parts: text("Remember remote") });
    const a = await appendMessage(db, "u1", s.id, { role: "assistant", parts: text("Suggested.") });
    await createProposal(db, "u1", {
      kind: "memory_add",
      payload: { category: "preference", content: "Prefers remote work", sensitive: false },
      sessionId: s.id,
      messageId: a.id,
    });
    expect(await deleteRepliesAfter(db, "u1", u.id)).toEqual({ sessionId: s.id });
    expect((await listProposals(db, "u1"))[0]).toMatchObject({
      messageId: null,
      sessionId: s.id,
      status: "pending",
    });
    expect(await recentMessages(db, "u1", s.id)).toHaveLength(1);
    await appendMessage(db, "u1", s.id, { role: "user", parts: text("newer") });
    await expect(deleteRepliesAfter(db, "u1", u.id)).rejects.toBeInstanceOf(ConflictError);
  });
  it("regenerating moves watermarks pointing at deleted replies back to the user message", async () => {
    const s = await getOrStartSession(db, "u1");
    const u = await appendMessage(db, "u1", s.id, { role: "user", parts: text("hi") });
    const a = await appendMessage(db, "u1", s.id, { role: "assistant", parts: text("Hello.") });
    await setCuratedThrough(db, "u1", s.id, a.id);
    await setSessionSummary(db, "u1", s.id, { summary: "S", throughMessageId: a.id });
    await deleteRepliesAfter(db, "u1", u.id);
    expect(await getSessionState(db, "u1", s.id)).toMatchObject({
      curatedThroughMessageId: u.id,
      summarizedThroughMessageId: u.id,
    });
  });
  it("regenerating leaves watermarks on earlier messages alone", async () => {
    const s = await getOrStartSession(db, "u1");
    const u0 = await appendMessage(db, "u1", s.id, { role: "user", parts: text("first") });
    await appendMessage(db, "u1", s.id, { role: "assistant", parts: text("reply") });
    const u = await appendMessage(db, "u1", s.id, { role: "user", parts: text("second") });
    await setCuratedThrough(db, "u1", s.id, u0.id);
    await appendMessage(db, "u1", s.id, { role: "assistant", parts: text("reply 2") });
    await deleteRepliesAfter(db, "u1", u.id);
    expect((await getSessionState(db, "u1", s.id)).curatedThroughMessageId).toBe(u0.id);
  });
  it("returns null when retrying an unknown or foreign message", async () => {
    const s = await getOrStartSession(db, "u1");
    const u = await appendMessage(db, "u1", s.id, { role: "user", parts: text("hi") });
    expect(await deleteRepliesAfter(db, "u1", "00000000-0000-4000-8000-0000000000aa")).toBeNull();
    expect(await deleteRepliesAfter(db, "u2", u.id)).toBeNull();
  });
});

describe("lifecycle helpers", () => {
  it("finalizes a placeholder, bumping last_message_at, and deletes messages", async () => {
    const s = await getOrStartSession(db, "u1", { now: new Date(Date.now() - H) });
    const p = await appendMessage(db, "u1", s.id, {
      role: "assistant",
      parts: [],
      status: "interrupted",
    });
    await finalizeMessage(db, "u1", p.id, {
      parts: text("Done."),
      status: "complete",
      inputTokens: 5,
      outputTokens: 7,
      skills: ["core"],
    });
    expect(await recentMessages(db, "u1", s.id)).toHaveLength(1);
    expect(await recentSkills(db, "u1", s.id)).toEqual([["core"]]);
    expect((await getSessionState(db, "u1", s.id)).lastMessageAt.getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
    await expect(
      finalizeMessage(db, "u2", p.id, { parts: [], status: "complete" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteMessage(db, "u2", p.id)).rejects.toBeInstanceOf(NotFoundError);
    await deleteMessage(db, "u1", p.id);
    expect(await recentMessages(db, "u1", s.id)).toEqual([]);
  });
  it("backdates messages with createdAt and uses it as last_message_at", async () => {
    const at = new Date(Date.now() - 48 * H);
    const s = await getOrStartSession(db, "u1", { now: at });
    await appendMessage(db, "u1", s.id, { role: "user", parts: text("old"), createdAt: at });
    expect((await getSessionState(db, "u1", s.id)).lastMessageAt).toEqual(at);
  });
  it("lists messages after a watermark and tracks recentSkills per turn", async () => {
    const s = await getOrStartSession(db, "u1");
    const m1 = await appendMessage(db, "u1", s.id, { role: "user", parts: text("a") });
    const m2 = await appendMessage(db, "u1", s.id, { role: "user", parts: text("b") });
    expect((await messagesAfter(db, "u1", s.id, null)).map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect((await messagesAfter(db, "u1", s.id, m1.id)).map((m) => m.id)).toEqual([m2.id]);
    for (const k of ["core", "direction", "planning", "intake"]) {
      await appendMessage(db, "u1", s.id, { role: "assistant", parts: text(k), skills: [k] });
    }
    expect(await recentSkills(db, "u1", s.id)).toEqual([["direction"], ["planning"], ["intake"]]);
    expect(await recentSkills(db, "u1", s.id, 1)).toEqual([["intake"]]);
  });
  it("stores watermarks and clears the summary embedding on a new summary", async () => {
    const s = await getOrStartSession(db, "u1");
    const m = await appendMessage(db, "u1", s.id, { role: "user", parts: text("a") });
    await setSessionSummary(db, "u1", s.id, {
      summary: "Talked about nursing.",
      throughMessageId: m.id,
    });
    await setCuratedThrough(db, "u1", s.id, m.id);
    expect(await getSessionState(db, "u1", s.id)).toMatchObject({
      summary: "Talked about nursing.",
      summarizedThroughMessageId: m.id,
      curatedThroughMessageId: m.id,
    });
    await expect(getSessionState(db, "u2", s.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setCuratedThrough(db, "u2", s.id, m.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
