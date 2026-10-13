import { randomUUID } from "node:crypto";
import { runTurn, type Screen } from "@pathwise/core/agent";
import { ConflictError, LlmUnavailableError } from "@pathwise/core/errors";
import { isAuthError } from "@pathwise/core/llm";
import { createLogger } from "@pathwise/core/logger";
import { z } from "zod";
import { getJobQueue } from "@/lib/jobs";
import { getServer } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const log = createLogger("web");

const SCREENS = [
  "today",
  "coach",
  "profile",
  "stories",
  "plan",
] as const satisfies readonly Screen[];
const bodySchema = z.object({
  message: z.object({
    id: z.string(),
    role: z.literal("user"),
    parts: z
      .array(z.object({ type: z.literal("text"), text: z.string().min(1).max(20000) }))
      .min(1)
      .max(10),
  }),
  screen: z.enum(SCREENS).optional(),
  topic: z.string().min(1).max(80).optional(),
  workflowRunId: z.string().uuid().optional(),
});

// Plain-text bodies: useChat surfaces them as error.message.
const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function POST(req: Request) {
  const user = await requireApiSession(req);
  if (!user) return text("Sign in again to continue.", 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return text("That message couldn't be sent.", 400);
  const { message, screen, topic, workflowRunId } = parsed.data;
  if (workflowRunId) return text("Workflows are not available yet.", 400);

  // useChat sends UUIDs; any other client's id is replaced (that client can't regenerate).
  const id = z.string().uuid().safeParse(message.id).success ? message.id : randomUUID();
  const { db, config } = getServer();
  try {
    return await runTurn(
      { db, config, queue: getJobQueue() },
      { userId: user.userId, message: { ...message, id }, screen, topic },
    );
  } catch (e) {
    if ((e instanceof LlmUnavailableError && e.reason === "auth_failed") || isAuthError(e)) {
      return text("Your API key was rejected. Update it in Settings.", 409);
    }
    if (e instanceof LlmUnavailableError) {
      return text("Connect an AI provider in Settings to use the coach.", 409);
    }
    if (e instanceof ConflictError) return text(e.message, 409);
    log.error({ userId: user.userId, err: e instanceof Error ? e.name : typeof e }, "chat failed");
    return text("Something went wrong. Retry in a moment.", 500);
  }
}
