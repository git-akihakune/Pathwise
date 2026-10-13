import { generateTextFor, type Llm, type LlmDeps } from "@pathwise/core/llm";
import type { EvalPersona } from "./personas";
import type { CaseResult } from "./types";
export function simulateUserReply(
  deps: LlmDeps,
  judgeLlm: Llm,
  persona: EvalPersona,
  transcript: CaseResult["transcript"],
): Promise<string> {
  return generateTextFor(deps, judgeLlm, {
    role: "main",
    purpose: "eval.simulate",
    instructions: `You are role-playing ${persona.data.name}, talking to an AI career coach. Background: ${persona.brief}. Stay in character and reply as ${persona.data.name} in one to three sentences. Only state facts from your background; if asked about something not in it, say you're not sure. Never mention that you are simulated.`,
    messages: transcript.map((m) => ({
      role: m.role === "assistant" ? "user" : "assistant",
      content: m.text,
    })),
  });
}
