"use client";

import { useChat } from "@ai-sdk/react";
import type { Screen } from "@pathwise/core/agent";
import type { CoachUIMessage } from "@pathwise/core/services/sessions";
import { DefaultChatTransport } from "ai";
import { ArrowDown, ArrowUp, MessageCircle, Square } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useRef, useState, useTransition } from "react";
import { MessagePart, uuid } from "@/components/chat/message-parts";
import { groupBySession } from "@/components/chat/session-groups";
import type { ProposalView } from "@/components/proposal-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useChatScroll } from "@/components/use-chat-scroll";
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
  const { messages, setMessages, sendMessage, regenerate, stop, status, error } =
    useChat<CoachUIMessage>({
      id: "coach",
      messages: initialMessages,
      generateId: uuid,
      transport,
    });
  const scroll = useChatScroll(messages);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
      scroll.pause();
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
    <div className="workspace-section flex min-w-0 flex-col gap-6">
      {hasMore && (
        <div className="flex flex-col items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingEarlier}
            aria-busy={loadingEarlier}
            onClick={loadEarlier}
          >
            Load earlier messages
          </Button>
          {earlierError && <Alert variant="destructive">{earlierError}</Alert>}
        </div>
      )}
      {messages.length === 0 && (
        <div className="flex min-h-64 flex-col justify-center gap-5 rounded-xl bg-muted/50 p-6 sm:p-8">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-primary">
            <MessageCircle className="size-6" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-heading text-2xl font-semibold">What's on your mind?</h2>
            <p className="mt-3 max-w-xl text-muted-foreground">
              Start a conversation. Your coach remembers what you share, and anything it wants to
              save waits for your approval.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              "Help me find a career direction",
              "Let's plan my next step",
              "I want to reflect on my week",
            ].map((starter) => (
              <Button
                key={starter}
                type="button"
                variant="outline"
                onClick={() => {
                  setInput(starter);
                  inputRef.current?.focus();
                }}
              >
                {starter}
              </Button>
            ))}
          </div>
        </div>
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
                  ? "chat-message ml-auto max-w-[92%] rounded-2xl rounded-br-sm bg-accent px-5 py-3 sm:max-w-[80%]"
                  : "chat-message flex max-w-full flex-col gap-3 px-1 py-2 sm:max-w-[92%]"
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
      <div role="status" className="flex min-h-6 items-center gap-2 text-sm text-muted-foreground">
        {busy && (
          <>
            <span
              className="size-2 rounded-full bg-primary motion-safe:animate-pulse"
              aria-hidden="true"
            />
            {status === "submitted" ? "Coach is thinking…" : "Coach is replying…"}
          </>
        )}
      </div>
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
      <div className="chat-composer flex flex-col gap-3 border-t pt-4">
        {scroll.away && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-center"
            onClick={scroll.latest}
          >
            <ArrowDown aria-hidden="true" />
            Jump to latest
          </Button>
        )}
        {topic ? (
          <div className="flex items-center gap-3 text-sm">
            <span>Your next message starts a focused session: {topic}</span>
            <Button type="button" size="sm" variant="ghost" onClick={cancelTopic}>
              Cancel
            </Button>
          </div>
        ) : topicDraft !== null ? (
          <div className="flex flex-wrap items-end gap-3">
            <Label className="flex-col items-start gap-1">
              Topic
              <Input
                value={topicDraft}
                maxLength={80}
                onChange={(e) => setTopicDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
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
        <Form
          noValidate
          trackChanges={false}
          dirty={Boolean(input.trim())}
          onSubmit={submit}
          className="flex items-end gap-3"
        >
          <Textarea
            className="resize-none"
            ref={inputRef}
            aria-label="Message"
            placeholder="Tell your coach what's on your mind…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={20000}
          />
          {busy ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Stop reply"
              onClick={() => {
                void stop();
              }}
            >
              <Square className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim()} aria-label="Send">
              <ArrowUp className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Send</span>
            </Button>
          )}
        </Form>
        <p className="text-xs text-muted-foreground">
          Enter to send · Shift + Enter for a new line. Suggestions wait for your approval.
        </p>
      </div>
      <div ref={scroll.end} className="h-px" />
    </div>
  );
}
