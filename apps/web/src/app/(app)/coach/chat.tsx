"use client";

import { useChat } from "@ai-sdk/react";
import type { Screen } from "@pathwise/core/agent";
import type { CoachUIMessage } from "@pathwise/core/services/sessions";
import { DefaultChatTransport } from "ai";
import { type FormEvent, type KeyboardEvent, useRef, useState, useTransition } from "react";
import { MessagePart, uuid } from "@/components/chat/message-parts";
import { groupBySession } from "@/components/chat/session-groups";
import type { ProposalView } from "@/components/proposal-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { loadEarlierAction } from "./actions";

export function Chat({
  initialMessages,
  initialProposals,
  initialHasMore,
  screen,
  prompt,
  timeZone,
}: {
  initialMessages: CoachUIMessage[];
  initialProposals: Record<string, ProposalView>;
  initialHasMore: boolean;
  screen: Screen;
  prompt: string;
  timeZone: string;
}) {
  const topicRef = useRef<string | null>(null);
  const [transport] = useState(
    () =>
      new DefaultChatTransport<CoachUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => {
          const body = { message: messages.at(-1), screen, topic: topicRef.current ?? undefined };
          topicRef.current = null;
          return { body };
        },
      }),
  );
  const { messages, setMessages, sendMessage, regenerate, status, error } = useChat<CoachUIMessage>(
    {
      id: "coach",
      messages: initialMessages,
      generateId: uuid,
      transport,
    },
  );
  const [proposals, setProposals] = useState(initialProposals);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [earlierError, setEarlierError] = useState<string>();
  const [loadingEarlier, startLoadingEarlier] = useTransition();
  const [input, setInput] = useState(prompt);
  const [topicDraft, setTopicDraft] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);

  const busy = status === "submitted" || status === "streaming";
  const send = (text: string) => {
    if (busy || !text.trim()) return;
    void sendMessage({ text });
    setTopic(null);
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || !input.trim()) return;
    send(input);
    setInput("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  const startTopic = () => {
    const t = topicDraft?.trim();
    if (!t) return;
    topicRef.current = t;
    setTopic(t);
    setTopicDraft(null);
  };
  const cancelTopic = () => {
    topicRef.current = null;
    setTopic(null);
  };
  const loadEarlier = () =>
    startLoadingEarlier(async () => {
      const before = messages[0]?.metadata?.createdAt;
      if (!before) return;
      const r = await loadEarlierAction(before);
      if ("error" in r) {
        setEarlierError(r.error);
        return;
      }
      setEarlierError(undefined);
      setMessages((current) => [...r.messages, ...current]);
      setProposals((current) => ({ ...r.proposals, ...current }));
      setHasMore(r.hasMore);
    });

  const date = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  const last = messages.at(-1);
  const interrupted =
    status === "ready" && last?.role === "assistant" && last.metadata?.status === "interrupted";
  const unanswered = status === "ready" && !error && last?.role === "user";

  return (
    <div className="flex flex-col gap-4">
      {hasMore && (
        <div className="flex flex-col items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingEarlier}
            onClick={loadEarlier}
          >
            Load earlier messages
          </Button>
          {earlierError && <Alert variant="destructive">{earlierError}</Alert>}
        </div>
      )}
      {messages.length === 0 && (
        <p className="text-muted-foreground">
          Start a conversation. Your coach remembers what you share, and anything it wants to save
          waits for your approval.
        </p>
      )}
      {groupBySession(messages).map((g) => (
        <section key={g.sessionId} className="flex flex-col gap-3">
          {g.startedAt && (
            // biome-ignore lint/a11y/useSemanticElements: an <hr> can't hold the session label
            <div
              role="separator"
              className="border-b pb-1 text-center text-xs text-muted-foreground"
            >
              {g.topic ? `Focused session: ${g.topic}` : "Session"} ·{" "}
              {date.format(new Date(g.startedAt))}
            </div>
          )}
          {g.messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[80%] rounded-lg bg-muted px-3 py-2"
                  : "flex max-w-[90%] flex-col gap-2"
              }
            >
              {m.parts.map((part, i) => (
                <MessagePart
                  // biome-ignore lint/suspicious/noArrayIndexKey: parts have no ids and only grow
                  key={i}
                  part={part}
                  role={m.role}
                  proposals={proposals}
                  send={send}
                  busy={busy}
                />
              ))}
            </div>
          ))}
        </section>
      ))}
      {status === "submitted" && (
        <p className="text-sm text-muted-foreground">Coach is thinking…</p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-4">
            {error.message}
            <Button type="button" size="sm" variant="outline" onClick={() => regenerate()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {interrupted && last && (
        <div className="flex items-center gap-3 text-sm">
          <span>This reply was interrupted.</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => regenerate({ messageId: last.id })}
          >
            Regenerate
          </Button>
        </div>
      )}
      {unanswered && (
        <div className="flex items-center gap-3 text-sm">
          <span>This message didn't get a reply.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => regenerate()}>
            Retry
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-2 border-t pt-4">
        {topic ? (
          <div className="flex items-center gap-3 text-sm">
            <span>Your next message starts a focused session: {topic}</span>
            <Button type="button" size="sm" variant="ghost" onClick={cancelTopic}>
              Cancel
            </Button>
          </div>
        ) : topicDraft !== null ? (
          <div className="flex items-end gap-2">
            <Label className="flex-col items-start gap-1">
              Topic
              <Input
                value={topicDraft}
                maxLength={80}
                onChange={(e) => setTopicDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    startTopic();
                  }
                }}
              />
            </Label>
            <Button type="button" size="sm" onClick={startTopic}>
              Start session
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setTopicDraft(null)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div>
            <Button type="button" size="sm" variant="outline" onClick={() => setTopicDraft("")}>
              New focused session
            </Button>
          </div>
        )}
        <form onSubmit={submit} className="flex items-end gap-2">
          <Textarea
            aria-label="Message"
            placeholder="Tell your coach what's on your mind…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={20000}
          />
          <Button type="submit" disabled={busy}>
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}
