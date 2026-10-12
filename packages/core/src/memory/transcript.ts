import type { UIMessage } from "ai";

/** Plain-text transcript for the curator and summarizer: "User: …" / "Coach: …". */
export function renderTranscript(messages: UIMessage[]): string {
  return messages
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
