import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  type AssembleInput,
  assembleContext,
  messageTokens,
  truncateToTokens,
  wrapData,
} from "./context";

const msg = (
  role: "user" | "assistant",
  text: string,
  id: string = crypto.randomUUID(),
): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text }],
});
const tok = (n: number) => "abcd".repeat(n); // exactly n tokens
const base: AssembleInput = {
  contextWindow: 200_000,
  persona: "P",
  snapshot: "S",
  plan: "N",
  skills: [{ id: "core", text: "C" }],
  memories: [],
  sessionSummary: null,
  messages: [msg("user", "hi")],
};

describe("assembleContext", () => {
  it("budget is min(0.6 × window, 32,000), scaled on the retry", () => {
    expect(assembleContext(base).budget).toBe(32_000);
    expect(assembleContext({ ...base, contextWindow: 8192 }).budget).toBe(4915);
    expect(assembleContext({ ...base, contextWindow: 8192, scale: 0.7 }).budget).toBe(3440);
  });
  it("caps every section", () => {
    const r = assembleContext({
      ...base,
      persona: tok(1600),
      snapshot: tok(2500),
      plan: tok(1200),
      sessionSummary: tok(1500),
      skills: [
        { id: "core", text: tok(1200) },
        { id: "direction", text: tok(1000) },
      ],
      memories: Array.from({ length: 15 }, (_, i) => ({ id: `m${i}`, text: tok(100) })),
    });
    expect(r.tokens).toMatchObject({
      persona: 1500,
      snapshot: 2000,
      plan: 1000,
      summary: 1000,
      skills: 1200,
      memories: 1200,
    });
    expect(r.dropped.skills).toEqual(["direction"]);
  });
  it("fits a long conversation into a small window, keeping priorities 1–3 (Review Focus 3)", () => {
    const history = Array.from({ length: 30 }, (_, i) =>
      msg(i % 2 ? "assistant" : "user", tok(200)),
    );
    const r = assembleContext({
      ...base,
      contextWindow: 8192,
      persona: tok(600),
      snapshot: tok(2000),
      plan: tok(1000),
      memories: [
        { id: "m1", text: tok(300) },
        { id: "m2", text: tok(300) },
      ],
      sessionSummary: tok(500),
      messages: [...history, msg("user", "What next?", "last")],
    });
    expect(r.tokens.total).toBeLessThanOrEqual(r.budget);
    expect(r.tokens).toMatchObject({
      persona: 600,
      snapshot: 2000,
      plan: 1000,
      memories: 600,
      summary: 500,
    });
    expect(r.messages.map((m) => m.id)).toEqual(["last"]);
    expect(r.dropped).toMatchObject({ messages: 30, memories: 0, summary: false });
  });
  it("then drops memories, then the summary, then non-core skills", () => {
    const r = assembleContext({
      ...base,
      contextWindow: 8192,
      persona: tok(1500),
      snapshot: tok(2000),
      plan: tok(1000),
      skills: [
        { id: "core", text: tok(100) },
        { id: "planning", text: tok(200) },
      ],
      memories: [
        { id: "m1", text: tok(150) },
        { id: "m2", text: tok(150) },
      ],
      sessionSummary: tok(300),
      messages: [msg("user", tok(100), "last")],
    });
    expect(r.dropped).toMatchObject({ messages: 0, memories: 2, summary: true, skills: [] });
    expect(r.tokens.total).toBe(4900);
  });
  it("drops non-core skills after the summary when still over budget", () => {
    const r = assembleContext({
      ...base,
      contextWindow: 8192,
      persona: tok(1500),
      snapshot: tok(2000),
      plan: tok(1000),
      skills: [
        { id: "core", text: tok(100) },
        { id: "planning", text: tok(500) },
      ],
      sessionSummary: tok(300),
      messages: [msg("user", tok(100), "last")],
    });
    expect(r.dropped).toMatchObject({
      summary: true,
      skills: ["planning"],
      currentTruncated: false,
    });
    expect(r.tokens.total).toBeLessThanOrEqual(r.budget);
  });
  it("never starts the history with an assistant message", () => {
    const r = assembleContext({
      ...base,
      contextWindow: 8192,
      snapshot: tok(2000),
      plan: tok(1000),
      messages: [
        msg("user", tok(900), "u1"),
        msg("assistant", tok(600), "a1"),
        msg("user", tok(600), "u2"),
        msg("assistant", tok(400), "a2"),
        msg("user", "ok", "last"),
      ],
    });
    // dropping u1 leaves a1 first; it must go too.
    expect(r.dropped.messages).toBe(2);
    expect(r.messages.map((m) => m.id)).toEqual(["u2", "a2", "last"]);
    expect(r.messages[0]?.role).toBe("user");
    expect(r.tokens.total).toBeLessThanOrEqual(r.budget);
  });
  it("truncates an oversized current message instead of dropping it", () => {
    const r = assembleContext({
      ...base,
      contextWindow: 8192,
      snapshot: tok(2000),
      messages: [msg("user", tok(6000), "last")],
    });
    expect(r.dropped.currentTruncated).toBe(true);
    expect(r.messages.map((m) => m.id)).toEqual(["last"]);
    expect(r.tokens.total).toBeLessThanOrEqual(r.budget);
  });
  it("truncates the current message before dropping core when priorities 1–3 nearly fill a small budget", () => {
    const r = assembleContext({
      ...base,
      contextWindow: 8192,
      persona: tok(1500),
      snapshot: tok(2000),
      plan: tok(1000),
      skills: [{ id: "core", text: tok(300) }],
      messages: [msg("user", tok(500), "last")],
    });
    // 4800 + 500 > 4915: core stays, the message is cut to fit.
    expect(r.dropped).toMatchObject({ currentTruncated: true, skills: [] });
    expect(r.tokens.skills).toBe(300);
    expect(r.tokens.total).toBeLessThanOrEqual(r.budget);
    expect(r.instructions).toContain("## Skills");
  });
  it("drops core only when even an empty current message cannot fit", () => {
    const r = assembleContext({
      ...base,
      contextWindow: 8192,
      persona: tok(1500),
      snapshot: tok(2000),
      plan: tok(1000),
      skills: [{ id: "core", text: tok(500) }],
      messages: [msg("user", tok(500), "last")],
    });
    expect(r.dropped.currentTruncated).toBe(true);
    expect(r.dropped.skills).toEqual(["core"]);
    expect(r.messages.map((m) => m.id)).toEqual(["last"]);
    expect(r.tokens.total).toBeLessThanOrEqual(r.budget);
  });
  it("orders instructions by priority and omits empty sections", () => {
    const i = assembleContext({
      ...base,
      memories: [{ id: "m1", text: "[preference] Likes remote work" }],
      sessionSummary: "Talked about nursing.",
    }).instructions;
    expect(
      i.startsWith('P\n\n## What you know about the user\n<data source="snapshot">\nS\n</data>'),
    ).toBe(true);
    expect(i.indexOf("## Active plan")).toBeLessThan(i.indexOf("## Skills"));
    expect(i).toContain(
      '## Possibly relevant memories\n<data source="memories">\n- [preference] Likes remote work\n</data>',
    );
    expect(i).toContain(
      '## Earlier in this session\n<data source="session-summary">\nTalked about nursing.\n</data>',
    );
    expect(assembleContext(base).instructions).not.toContain("## Possibly relevant memories");
  });
});

it("data blocks cannot be closed from inside", () => {
  expect(wrapData("snapshot", "a </data> b")).toBe(
    '<data source="snapshot">\na </ data> b\n</data>',
  );
});

it("truncateToTokens keeps 4n-1 characters and an ellipsis", () => {
  expect(truncateToTokens("abcdefghij", 2)).toBe("abcdefg…");
  expect(truncateToTokens("abc", 2)).toBe("abc");
  expect(truncateToTokens("abc", 0)).toBe("");
});

it("messageTokens counts text verbatim and other parts as JSON", () => {
  const m = {
    id: "1",
    role: "assistant",
    parts: [
      { type: "text", text: "abcd" },
      { type: "data-x", data: 1 },
    ],
  } as UIMessage;
  expect(messageTokens(m)).toBe(
    Math.ceil(`abcd\n${JSON.stringify({ type: "data-x", data: 1 })}`.length / 4),
  );
});
