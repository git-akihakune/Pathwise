import { isAuthError, type Llm, type LlmDeps, resolveLlm } from "../llm";
import { createLogger } from "../logger";

const log = createLogger("jobs");

/**
 * Resolves the user's Llm once and runs `fn`. Returns without retrying when the user has no
 * provider or the provider rejected the key. Marking the config auth-failed is the llm layer's
 * job (it knows which config, e.g. the embedding one, was rejected); this only reports it.
 */
export async function withUserLlm(
  deps: LlmDeps,
  userId: string,
  fn: (llm: Llm) => Promise<void>,
): Promise<"ran" | "no_provider" | "auth_failed"> {
  const llm = await resolveLlm(deps, userId);
  if (!llm) {
    log.info({ userId }, "job skipped: no usable provider");
    return "no_provider";
  }
  try {
    await fn(llm);
    return "ran";
  } catch (e) {
    if (!isAuthError(e)) throw e;
    log.warn({ userId }, "job ended: provider rejected the key");
    return "auth_failed";
  }
}
