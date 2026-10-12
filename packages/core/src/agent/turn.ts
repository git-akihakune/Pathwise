import { randomUUID } from "node:crypto";
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  type StreamTextResult,
  streamText,
  type TextStreamPart,
  type ToolSet,
  toUIMessageStream,
  type UIMessage,
  type UIMessageStreamOutcome,
  type UIMessageStreamWriter,
} from "ai";
import { LlmUnavailableError } from "../errors";
import { getSafetyResources } from "../instance";
import type { JobQueue } from "../jobs/queue";
import { JOBS } from "../jobs/queue";
import { isAuthError, type LlmDeps, markAuthFailed, recordUsage, requireLlm } from "../llm";
import { createLogger } from "../logger";
import { hybridSearch, type RetrievedItem } from "../memory/retrieval";
import { getSnapshotText } from "../memory/snapshot";
import { getActivePlan, mondayOf } from "../services/plan";
import {
  appendMessage,
  type CoachMessageMetadata,
  type CoachUIMessage,
  deleteMessage,
  deleteRepliesAfter,
  finalizeMessage,
  getOrStartSession,
  getSessionState,
  messagesAfter,
  recentMessages,
  recentSkills,
} from "../services/sessions";
import { effectiveTimezone, getUserSettings } from "../services/settings";
import { classify } from "./classify";
import {
  type AssembledContext,
  type AssembleInput,
  assembleContext,
  messageTokens,
  truncateToTokens,
} from "./context";
import { type Distress, keywordDistress, SAFETY_RESPONSE } from "./distress";
import { chatErrorMessage, isContextLengthError } from "./errors";
import { buildPersona } from "./persona";
import { renderPlanSummary } from "./plan-summary";
import {
  getSkill,
  mergeSkillTools,
  type Screen,
  type SkillContext,
  type SkillId,
  type WorkflowTurn,
} from "./registry";
import { selectSkills } from "./select";
import { guardTools, peekForEarlyError, writeText } from "./stream";

const log = createLogger("agent");

export interface TurnInput {
  userId: string;
  message: UIMessage;
  screen?: Screen;
  topic?: string;
  workflow?: WorkflowTurn;
}

export interface TurnDeps extends LlmDeps {
  queue: JobQueue;
}

export interface TurnResult {
  sessionId: string;
  assistantMessageId: string;
  status: "complete" | "interrupted";
  text: string;
}

const CURATE_DELAY_SECONDS = 1800;
const SUMMARIZE_SHARE = 0.6;
const errName = (e: unknown) => (e instanceof Error ? e.name : typeof e);

const textOf = (m: UIMessage) =>
  m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");

function formatRetrieved(i: RetrievedItem): string {
  if (i.kind === "memory") return `[${i.category}] ${i.text}`;
  if (i.kind === "story") return `[story] ${i.text}`;
  return `[earlier session ${i.createdAt.toISOString().slice(0, 10)}] ${i.text}`;
}

/** Text for a tool error part: domain errors carry user-readable messages. */
const toolErrorText = (e: unknown) =>
  typeof e === "string" ? e : e instanceof Error ? e.message : "The tool failed.";

/**
 * Runs one chat turn and returns its UI message stream response. Throws `LlmUnavailableError`
 * before storing anything when there is no usable provider, and `LlmUnavailableError("auth_failed")`
 * when the key is rejected before streaming (R11). Acute distress gets the safety response
 * without any model call (R17).
 */
export async function runTurn(
  deps: TurnDeps,
  input: TurnInput,
  hooks: { onTurnEnd?: (r: TurnResult) => Promise<void> } = {},
): Promise<Response> {
  const { db } = deps;
  const { userId, message, workflow } = input;
  const llm = await requireLlm(deps, userId);
  const text = textOf(message);
  const now = new Date();

  // Persist the user message; an already-stored id means "regenerate".
  const regenerate = await deleteRepliesAfter(db, userId, message.id);
  let sessionId: string;
  if (regenerate) {
    sessionId = regenerate.sessionId;
  } else {
    const session = await getOrStartSession(db, userId, {
      topic: input.topic,
      workflowRunId: workflow?.runId,
    });
    sessionId = session.id;
    await appendMessage(db, userId, sessionId, {
      id: message.id,
      role: "user",
      parts: message.parts,
    });
  }

  // The keyword check needs no model, so the crisis path survives a failing classifier (R17).
  let distress: Distress = keywordDistress(text);
  let classified: SkillId[] = [];
  if (!workflow && distress !== "acute") {
    const history = (await recentMessages(db, userId, sessionId, 5))
      .filter((m) => m.id !== message.id)
      .slice(-4);
    try {
      ({ skills: classified, distress } = await classify(deps, llm, { text, history }));
    } catch (e) {
      if (isAuthError(e)) throw new LlmUnavailableError("auth_failed");
      throw e;
    }
  }
  const acute = distress === "acute";

  const state = await getSessionState(db, userId, sessionId);
  const assistantId = randomUUID();
  const metadata: CoachMessageMetadata = {
    sessionId,
    sessionStartedAt: state.startedAt.toISOString(),
    topic: state.topic,
    createdAt: now.toISOString(),
    status: "complete",
  };

  let sections: Omit<AssembleInput, "contextWindow" | "scale"> | undefined;
  let tools: ToolSet = {};
  let skillIds: SkillId[] = [];
  const guard = { failures: 0 };
  if (!acute) {
    const [settings, recent, snapshot, activePlan, retrieved, after] = await Promise.all([
      getUserSettings(db, userId),
      recentSkills(db, userId, sessionId),
      getSnapshotText(db, userId),
      getActivePlan(db, userId),
      hybridSearch(deps, llm, userId, text, { limit: 12, excludeSessionId: sessionId }),
      messagesAfter(db, userId, sessionId, state.summarizedThroughMessageId),
    ]);
    const timezone = effectiveTimezone(settings);
    skillIds = selectSkills({
      classified,
      recent: recent as SkillId[][],
      screen: input.screen,
      workflow,
    });
    const selected = skillIds.map(getSkill);
    const ctx: SkillContext = { deps, llm, userId, sessionId, messageId: assistantId, timezone };
    if (llm.capabilities.tools) tools = guardTools(mergeSkillTools(selected, ctx), guard);
    const skills: { id: string; text: string }[] = await Promise.all(
      selected.map(async (s) => {
        const provided = await Promise.all(
          (s.contextProviders ?? []).map(async (p) =>
            truncateToTokens(await p.render(ctx), p.maxTokens),
          ),
        );
        return {
          id: s.id,
          text: [s.promptFragment(ctx), ...provided].filter(Boolean).join("\n\n"),
        };
      }),
    );
    if (workflow) skills.push({ id: "workflow", text: `Current step goal: ${workflow.goal}` });

    const history: UIMessage[] = [...after.filter((m) => m.id !== message.id), message];
    // Providers expect the conversation to start with the user.
    while (history.length > 1 && history[0]?.role === "assistant") history.shift();

    sections = {
      persona: buildPersona({
        bluntness: settings.bluntness,
        distress: distress === "elevated" ? "elevated" : "none",
        now,
        timezone,
        tools: llm.capabilities.tools,
      }),
      snapshot,
      plan: renderPlanSummary(activePlan, mondayOf(now, timezone)),
      skills,
      memories: retrieved.map((i) => ({ id: i.id, text: formatRetrieved(i) })),
      sessionSummary: state.summary,
      messages: history,
    };
  }

  // Proposals reference the assistant message, so it exists before any tool runs (Spec gaps 5).
  await appendMessage(db, userId, sessionId, {
    id: assistantId,
    role: "assistant",
    parts: [],
    status: "interrupted",
    skills: skillIds,
  });

  let streamError: unknown;
  let afterRetry = false;
  // biome-ignore lint/suspicious/noExplicitAny: context and output types are irrelevant here
  let result: StreamTextResult<ToolSet, any, any> | undefined;
  let assembled: AssembledContext | undefined;

  const send = async (name: string, data: object, opts: Parameters<JobQueue["send"]>[2]) => {
    try {
      await deps.queue.send(name, data, opts);
    } catch (e) {
      log.error({ userId, sessionId, job: name, err: errName(e) }, "enqueue failed");
    }
  };

  const finalize = async (
    reply: CoachUIMessage,
    outcome: UIMessageStreamOutcome,
    aborted: boolean,
  ) => {
    const content = reply.parts.filter((p) => p.type !== "step-start");
    const failed = aborted || outcome.status === "failed";
    const status =
      content.length === 0 || streamError !== undefined || failed ? "interrupted" : "complete";
    const replyText = textOf(reply);
    try {
      let usage: { inputTokens: number; outputTokens: number } | undefined;
      if (result) {
        const total = await Promise.resolve(result.totalUsage).catch(() => undefined);
        usage = { inputTokens: total?.inputTokens ?? 0, outputTokens: total?.outputTokens ?? 0 };
      }
      if (content.length === 0) {
        await deleteMessage(db, userId, assistantId);
      } else {
        await finalizeMessage(db, userId, assistantId, {
          parts: reply.parts,
          status,
          ...usage,
          skills: skillIds,
        });
      }
      if (usage && usage.inputTokens + usage.outputTokens > 0) {
        await recordUsage(db, {
          userId,
          providerConfigId: llm.providerConfigId,
          model: llm.modelId("main") ?? "unknown",
          role: "main",
          purpose: "chat",
          ...usage,
        });
      }
      const error = streamError ?? (outcome.status === "failed" ? outcome.error : undefined);
      if (isAuthError(error)) await markAuthFailed(db, llm.providerConfigId);

      await send(
        JOBS.sessionCurate,
        { userId, sessionId },
        { startAfterSeconds: CURATE_DELAY_SECONDS },
      );
      if (assembled) {
        const unsummarized = await messagesAfter(
          db,
          userId,
          sessionId,
          state.summarizedThroughMessageId,
        );
        const tokens = unsummarized.reduce((n, m) => n + messageTokens(m), 0);
        if (tokens > SUMMARIZE_SHARE * assembled.messagesBudget) {
          await send(JOBS.sessionSummarize, { userId, sessionId }, { singletonKey: sessionId });
        }
      }
    } catch (e) {
      log.error({ userId, sessionId, err: errName(e) }, "turn finalize failed");
    }
    try {
      await hooks.onTurnEnd?.({
        sessionId,
        assistantMessageId: assistantId,
        status,
        text: replyText,
      });
    } catch (e) {
      log.error({ userId, sessionId, err: errName(e) }, "onTurnEnd failed");
    }
  };

  const respond = async (writer: UIMessageStreamWriter<CoachUIMessage>) => {
    writer.write({ type: "start", messageId: assistantId, messageMetadata: metadata });
    if (!sections) {
      writeText(writer, SAFETY_RESPONSE(await getSafetyResources(db)));
      return;
    }
    for (const scale of [1, 0.7]) {
      afterRetry = scale < 1;
      assembled = assembleContext({
        ...sections,
        contextWindow: llm.capabilities.contextWindow,
        scale,
      });
      const current = streamText({
        model: llm.model("main", "chat"),
        instructions: assembled.instructions,
        messages: await convertToModelMessages(assembled.messages, {
          tools,
          ignoreIncompleteToolCalls: true,
        }),
        tools,
        maxRetries: 2,
        // toolChoice stays "auto": forced tool choice is rejected by some providers.
        stopWhen: [isStepCount(5), () => guard.failures >= 2],
        onError: ({ error }) =>
          log.warn({ userId, sessionId, err: errName(error) }, "chat stream error"),
      });
      result = current;
      const { early, stream: parts } = await peekForEarlyError(current.stream);
      if (scale === 1 && isContextLengthError(early)) {
        // Abandon this attempt: drain it so nothing is left pending, then retry smaller.
        await consumeStream({ stream: parts, onError: () => {} });
        continue;
      }
      const tracked = parts.pipeThrough(
        new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
          transform(part, c) {
            if (part.type === "error") streamError = part.error;
            c.enqueue(part);
          },
        }),
      );
      writer.merge(
        toUIMessageStream<ToolSet, CoachUIMessage>({
          stream: tracked,
          tools,
          sendStart: false,
          // Stream errors get the §9 copy; tool errors (also routed here) keep their message.
          onError: (e) =>
            e === streamError
              ? chatErrorMessage(e, { afterContextRetry: afterRetry })
              : toolErrorText(e),
        }),
      );
      return;
    }
  };

  const stream = createUIMessageStream<CoachUIMessage>({
    // Also called with every error chunk the merged stream already carried, so it doesn't log.
    onError: (e) => chatErrorMessage(e),
    execute: async ({ writer }) => {
      try {
        await respond(writer);
      } catch (e) {
        log.warn({ userId, sessionId, err: errName(e) }, "chat turn failed");
        throw e;
      }
    },
    onEnd: ({ responseMessage, isAborted, outcome }) =>
      finalize(responseMessage, outcome, isAborted),
  });
  return createUIMessageStreamResponse({ stream, consumeSseStream: consumeStream });
}
