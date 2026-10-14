import { truncateToTokens, wrapData } from "../agent/context";
import { generateTextFor } from "../llm/generate";
import type { Llm, LlmDeps } from "../llm/types";
import { getSessionState, messagesAfter, setSessionSummary } from "../services/sessions";
import { renderTranscript } from "./transcript";

const INSTRUCTIONS =
  "Update the running summary of this coaching session. Keep facts the user stated, decisions, open questions, and next steps. Third person, at most 200 words. Never add facts that are not in the data.";

/** Folds all but the newest `keepLast` unsummarized messages into the session's rolling summary. False when there is nothing to summarize. */
export async function summarizeSession(
  deps: LlmDeps,
  llm: Llm,
  userId: string,
  sessionId: string,
  o: { keepLast: number },
): Promise<boolean> {
  const { db } = deps;
  const state = await getSessionState(db, userId, sessionId);
  const all = await messagesAfter(db, userId, sessionId, state.summarizedThroughMessageId);
  const msgs = all.slice(0, Math.max(0, all.length - o.keepLast));
  const last = msgs[msgs.length - 1];
  if (!last) return false;
  const text = await generateTextFor(deps, llm, {
    role: "fast",
    purpose: "session.summarize",
    instructions: INSTRUCTIONS,
    prompt: `${wrapData("previous-summary", state.summary ?? "none")}\n${wrapData("transcript", renderTranscript(msgs))}`,
  });
  await setSessionSummary(db, userId, sessionId, {
    summary: truncateToTokens(text.trim(), 1000),
    throughMessageId: last.id,
  });
  return true;
}
