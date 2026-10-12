import { eq } from "drizzle-orm";
import { decryptSecret, loadKeyring, SecretDecryptError } from "../crypto";
import { type Db, schema } from "../db";
import { LlmUnavailableError, type LlmUnavailableReason } from "../errors";
import { createLogger } from "../logger";
import { createEmbeddingModel, createLanguageModel, type ProviderTarget } from "./factory";
import type { Llm, LlmDeps, ProviderKind, ProviderStatus } from "./types";

const log = createLogger("llm");

type ProviderRow = typeof schema.providerConfigs.$inferSelect;

/**
 * The one place that decides which provider_configs row applies to a user: their active
 * config, else the instance config. No fallthrough when the user's own config is unusable.
 */
export async function pickProviderRow(
  db: Db,
  userId: string,
): Promise<{ row: ProviderRow; source: "user" | "instance" } | null> {
  const [settings] = await db
    .select({ id: schema.userSettings.providerConfigId })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId));
  let id = settings?.id ?? null;
  let source: "user" | "instance" = "user";
  if (!id) {
    const [inst] = await db
      .select({ id: schema.instanceSettings.instanceProviderConfigId })
      .from(schema.instanceSettings)
      .where(eq(schema.instanceSettings.id, 1));
    id = inst?.id ?? null;
    source = "instance";
  }
  if (!id) return null;
  const [row] = await db
    .select()
    .from(schema.providerConfigs)
    .where(eq(schema.providerConfigs.id, id));
  return row ? { row, source } : null;
}

function toTarget(deps: LlmDeps, row: ProviderRow): ProviderTarget | null {
  let apiKey: string | null = null;
  if (row.encryptedKey) {
    try {
      apiKey = decryptSecret(loadKeyring(deps.config), row.encryptedKey, row.id);
    } catch (err) {
      if (!(err instanceof SecretDecryptError)) throw err;
      log.warn({ providerConfigId: row.id }, "provider key could not be decrypted");
      return null;
    }
  }
  return {
    id: row.id,
    kind: row.kind as ProviderKind,
    baseUrl: row.baseUrl,
    apiKey,
    models: row.models,
    contextWindow: row.contextWindow,
    capabilities: row.capabilities,
  };
}

function isUsable(row: ProviderRow): boolean {
  const status = row.status as ProviderStatus;
  return status === "full" || status === "degraded";
}

async function resolveEmbedding(
  deps: LlmDeps,
  row: ProviderRow,
  target: ProviderTarget,
): Promise<Llm["embedding"]> {
  const modelId = target.models.embedding;
  if (!modelId) return null;
  let embTarget: ProviderTarget | null = target;
  const refId = target.models.embeddingProviderConfigId;
  if (refId && refId !== row.id) {
    const [ref] = await deps.db
      .select()
      .from(schema.providerConfigs)
      .where(eq(schema.providerConfigs.id, refId));
    if (!ref || ref.userId !== row.userId || ref.authFailed) return null;
    embTarget = toTarget(deps, ref);
  }
  if (!embTarget) return null;
  const model = createEmbeddingModel(deps.config, {
    ...embTarget,
    models: { ...embTarget.models, embedding: modelId },
  });
  return model ? { model, modelId, providerConfigId: embTarget.id } : null;
}

async function resolve(
  deps: LlmDeps,
  userId: string,
): Promise<{ llm: Llm } | { reason: LlmUnavailableReason }> {
  const picked = await pickProviderRow(deps.db, userId);
  if (!picked) return { reason: "none" };
  const { row } = picked;
  if (row.authFailed) return { reason: "auth_failed" };
  if (!isUsable(row) || !row.capabilities) return { reason: "unusable" };
  const target = toTarget(deps, row);
  if (!target) return { reason: "unusable" };
  const capabilities = row.capabilities;
  const embedding = await resolveEmbedding(deps, row, target);
  return {
    llm: {
      userId,
      providerConfigId: row.id,
      kind: target.kind,
      capabilities,
      model: (role, purpose) => createLanguageModel(deps.config, target, role, purpose),
      modelId: (role) =>
        role === "embedding" ? (embedding?.modelId ?? null) : target.models[role],
      embedding,
    },
  };
}

export async function resolveLlm(deps: LlmDeps, userId: string): Promise<Llm | null> {
  const r = await resolve(deps, userId);
  return "llm" in r ? r.llm : null;
}

export async function requireLlm(deps: LlmDeps, userId: string): Promise<Llm> {
  const r = await resolve(deps, userId);
  if ("llm" in r) return r.llm;
  throw new LlmUnavailableError(r.reason);
}
