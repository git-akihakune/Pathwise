import type { UIMessage } from "ai";
import { SAFETY_LEAD } from "../agent/distress";

const isSafetyReply = (m: UIMessage) =>
  m.role === "assistant" &&
  m.parts.some((p) => p.type === "text" && p.text.startsWith(SAFETY_LEAD));

/** Safety replies and the user message that triggered each are left out: nothing durable should be learnt from a crisis. */
function withoutSafetyTurns(messages: UIMessage[]): UIMessage[] {
  const skip = new Set<number>();
  messages.forEach((m, i) => {
    if (!isSafetyReply(m)) return;
    skip.add(i);
    if (messages[i - 1]?.role === "user") skip.add(i - 1);
  });
  return messages.filter((_, i) => !skip.has(i));
}

/** Plain-text transcript for the curator and summarizer: "User: …" / "Coach: …". */
export function renderTranscript(messages: UIMessage[]): string {
  return withoutSafetyTurns(messages)
    .map((m) => {
      const parts = m.parts.flatMap((p) => {
        if (p.type === "text") return [p.text];
        if (p.type === "dynamic-tool") return [`[Coach used ${p.toolName}]`];
        if (p.type.startsWith("tool-")) return [`[Coach used ${p.type.slice("tool-".length)}]`];
        return [];
      });
      return `${m.role === "user" ? "User" : "Coach"}: ${parts.join("\n")}`;
    })
    .join("\n\n");
}
