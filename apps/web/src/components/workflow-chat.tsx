"use client";

import { useChat } from "@ai-sdk/react";
import type { CoachUIMessage } from "@pathwise/core/services/sessions";
import { DefaultChatTransport } from "ai";
import { useRouter } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useState, useTransition } from "react";
import { MessagePart, uuid } from "@/components/chat/message-parts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** The conversation of one conversational workflow step. `moveOn` skips the step. */
export function WorkflowChat({
  runId,
  stepId,
  initialMessages,
  moveOn,
}: {
  runId: string;
  stepId: string;
  initialMessages: CoachUIMessage[];
  moveOn: () => Promise<void>;
}) {
  const router = useRouter();
  const [transport] = useState(
    () =>
      new DefaultChatTransport<CoachUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { message: messages.at(-1), workflowRunId: runId },
        }),
      }),
  );
  const { messages, sendMessage, regenerate, status, error } = useChat<CoachUIMessage>({
    id: `${runId}:${stepId}`,
    messages: initialMessages,
    generateId: uuid,
    transport,
    // The step may have finished (onFinish) or moved on under us (onError, e.g. a 409).
    onFinish: () => router.refresh(),
    onError: () => router.refresh(),
  });
  const [input, setInput] = useState("");
  const [skipping, startSkip] = useTransition();
  const busy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    if (busy || !text.trim()) return;
    void sendMessage({ text });
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

  return (
    <div className="flex flex-col gap-4">
      {messages.map((m) => (
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
              proposals={{}}
              send={send}
              busy={busy}
            />
          ))}
        </div>
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
      <form onSubmit={submit} className="flex items-end gap-2 border-t pt-4">
        <Textarea
          aria-label="Message"
          placeholder="Write your answer…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={20000}
        />
        <Button type="submit" disabled={busy}>
          Send
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || skipping}
          onClick={() => startSkip(moveOn)}
        >
          Move on
        </Button>
      </form>
    </div>
  );
}
