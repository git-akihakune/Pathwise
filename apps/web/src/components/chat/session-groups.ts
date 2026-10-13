import type { CoachUIMessage } from "@pathwise/core/services/sessions";

export interface SessionGroup {
  sessionId: string;
  startedAt: string | null;
  topic: string | null;
  messages: CoachUIMessage[];
}

/**
 * Splits the conversation into sessions by message metadata. A message without metadata (a user
 * message the server hasn't answered yet) joins the session of the next reply, or the last session.
 */
export function groupBySession(messages: CoachUIMessage[]): SessionGroup[] {
  const groups: SessionGroup[] = [];
  let waiting: CoachUIMessage[] = [];
  for (const m of messages) {
    if (!m.metadata) {
      waiting.push(m);
      continue;
    }
    const last = groups.at(-1);
    if (last?.sessionId === m.metadata.sessionId) {
      last.messages.push(...waiting, m);
    } else {
      groups.push({
        sessionId: m.metadata.sessionId,
        startedAt: m.metadata.sessionStartedAt,
        topic: m.metadata.topic,
        messages: [...waiting, m],
      });
    }
    waiting = [];
  }
  if (waiting.length > 0) {
    const last = groups.at(-1);
    if (last) last.messages.push(...waiting);
    else groups.push({ sessionId: "new", startedAt: null, topic: null, messages: waiting });
  }
  return groups;
}
