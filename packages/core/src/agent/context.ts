import type { UIMessage } from "ai";
import { estimateTokens } from "../llm/tokens";

export interface AssembleInput {
  contextWindow: number;
  scale?: number; // 1 (default) or 0.7
  persona: string;
  snapshot: string;
  plan: string; // priorities 1–3
  skills: { id: string; text: string }[]; // priority 4, core first
  memories: { id: string; text: string }[]; // priority 5, best first
  sessionSummary: string | null; // priority 6
  messages: UIMessage[]; // priority 7, oldest first; last = current user message
}

export interface AssembledContext {
  instructions: string;
  messages: UIMessage[];
  budget: number;
  messagesBudget: number;
  tokens: {
    persona: number;
    snapshot: number;
    plan: number;
    skills: number;
    memories: number;
    summary: number;
    messages: number;
    total: number;
  };
  dropped: {
    messages: number;
    memories: number;
    skills: string[];
    summary: boolean;
    currentTruncated: boolean;
  };
}

const CAPS = {
  persona: 1500,
  snapshot: 2000,
  plan: 1000,
  skills: 2000,
  memories: 2000,
  summary: 1000,
};
const MAX_MEMORIES = 12;
const MAX_BUDGET = 32_000;

export function truncateToTokens(text: string, max: number): string {
  if (max <= 0) return "";
  if (estimateTokens(text) <= max) return text;
  return `${text.slice(0, 4 * max - 1)}…`;
}

export function wrapData(source: string, text: string): string {
  return `<data source="${source}">\n${text.replaceAll("</data>", "</ data>")}\n</data>`;
}

export function messageTokens(m: UIMessage): number {
  return estimateTokens(
    m.parts
      .map((p) => (p.type === "text" ? (p as { text: string }).text : JSON.stringify(p)))
      .join("\n"),
  );
}

function takeWhileFits<T extends { text: string }>(items: T[], cap: number): T[] {
  const kept: T[] = [];
  let sum = 0;
  for (const item of items) {
    sum += estimateTokens(item.text);
    if (sum > cap) break;
    kept.push(item);
  }
  return kept;
}

/** Shrinks the text parts of a message by about `over` tokens; false when no text is left to cut. */
function shrinkMessage(m: UIMessage, over: number): UIMessage | null {
  let idx = -1;
  let longest = 0;
  m.parts.forEach((p, i) => {
    if (p.type !== "text") return;
    const len = (p as { text: string }).text.length;
    if (len > longest) {
      longest = len;
      idx = i;
    }
  });
  if (idx < 0) return null;
  const part = m.parts[idx] as { type: "text"; text: string };
  const next = truncateToTokens(part.text, estimateTokens(part.text) - over);
  const parts = m.parts.map((p, i) =>
    i === idx ? { ...part, text: next } : p,
  ) as UIMessage["parts"];
  return { ...m, parts };
}

export function assembleContext(input: AssembleInput): AssembledContext {
  const budget = Math.floor(Math.min(0.6 * input.contextWindow, MAX_BUDGET) * (input.scale ?? 1));

  const persona = truncateToTokens(input.persona, CAPS.persona);
  const snapshot = truncateToTokens(input.snapshot, CAPS.snapshot);
  const plan = truncateToTokens(input.plan, CAPS.plan);
  let summary: string | null = input.sessionSummary
    ? truncateToTokens(input.sessionSummary, CAPS.summary)
    : null;
  let skills = takeWhileFits(input.skills, CAPS.skills);
  const droppedSkills = input.skills.filter((s) => !skills.includes(s)).map((s) => s.id);
  let memories = takeWhileFits(input.memories.slice(0, MAX_MEMORIES), CAPS.memories);
  let droppedMemories = input.memories.length - memories.length;
  let messages = [...input.messages];
  let droppedMessages = 0;
  let droppedSummary = false;
  let currentTruncated = false;

  const sum = (items: { text: string }[]) => items.reduce((n, i) => n + estimateTokens(i.text), 0);
  const fixed = () =>
    estimateTokens(persona) +
    estimateTokens(snapshot) +
    estimateTokens(plan) +
    sum(skills) +
    sum(memories) +
    (summary ? estimateTokens(summary) : 0);
  const total = () => fixed() + messages.reduce((n, m) => n + messageTokens(m), 0);

  while (total() > budget) {
    const over = total() - budget;
    if (messages.length > 1) {
      messages.shift();
      droppedMessages++;
      while (messages.length > 1 && messages[0]?.role === "assistant") {
        messages.shift();
        droppedMessages++;
      }
    } else if (memories.length > 0) {
      memories = memories.slice(0, -1);
      droppedMemories++;
    } else if (summary !== null) {
      summary = null;
      droppedSummary = true;
    } else if (skills.length > 1) {
      droppedSkills.push((skills[skills.length - 1] as { id: string }).id);
      skills = skills.slice(0, -1);
    } else {
      // Only the current message and `core` are left: cut the message first, drop core last.
      const current = messages[0] as UIMessage;
      const shrunk = shrinkMessage(current, over);
      if (shrunk && messageTokens(shrunk) < messageTokens(current)) {
        messages = [shrunk];
        currentTruncated = true;
      } else if (skills.length > 0) {
        droppedSkills.push((skills[0] as { id: string }).id);
        skills = [];
      } else {
        break; // priorities 1–3 alone exceed the budget; nothing more can be trimmed
      }
    }
  }

  const tokens = {
    persona: estimateTokens(persona),
    snapshot: estimateTokens(snapshot),
    plan: estimateTokens(plan),
    skills: sum(skills),
    memories: sum(memories),
    summary: summary ? estimateTokens(summary) : 0,
    messages: messages.reduce((n, m) => n + messageTokens(m), 0),
    total: 0,
  };
  tokens.total = fixed() + tokens.messages;

  const sections = [
    persona,
    snapshot && `## What you know about the user\n${wrapData("snapshot", snapshot)}`,
    plan && `## Active plan\n${wrapData("plan", plan)}`,
    skills.length > 0 && `## Skills\n${skills.map((s) => s.text).join("\n\n")}`,
    memories.length > 0 &&
      `## Possibly relevant memories\n${wrapData("memories", `- ${memories.map((m) => m.text).join("\n- ")}`)}`,
    summary && `## Earlier in this session\n${wrapData("session-summary", summary)}`,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);

  return {
    instructions: sections.join("\n\n"),
    messages,
    budget,
    messagesBudget: budget - (tokens.total - tokens.messages),
    tokens,
    dropped: {
      messages: droppedMessages,
      memories: droppedMemories,
      skills: droppedSkills,
      summary: droppedSummary,
      currentTruncated,
    },
  };
}
