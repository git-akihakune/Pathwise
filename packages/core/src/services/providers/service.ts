import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { assertAdmin } from "../../admin";
import { decryptSecret, encryptSecret, loadKeyring, SecretDecryptError } from "../../crypto";
import { type Db, schema } from "../../db";
import { NotFoundError, ValidationError } from "../../errors";
import {
  type Capabilities,
  contextWindowFor,
  type LlmDeps,
  type ProbeChecks,
  type ProviderKind,
  type ProviderModels,
  type ProviderStatus,
  pickProviderRow,
  probeCapabilities,
} from "../../llm";
import { checkCustomEndpoint } from "./endpoint-policy";

export interface ProviderConfigInput {
  kind: ProviderKind;
  label: string;
  baseUrl?: string;
  apiKey?: string;
  models: ProviderModels;
  contextWindow?: number;
}

export interface ProviderConfigView {
  id: string;
  scope: "user" | "instance";
  kind: ProviderKind;
  label: string;
  baseUrl: string | null;
  keyLast4: string | null;
  models: ProviderModels;
  contextWindow: number | null;
  capabilities: Capabilities | null;
  status: ProviderStatus;
  authFailed: boolean;
  lastTestedAt: Date | null;
}

type Actor = { userId: string; role: "admin" | "user" };
type Row = typeof schema.providerConfigs.$inferSelect;

/** Deliberately omits encrypted_key. */
function toView(row: Row): ProviderConfigView {
  return {
    id: row.id,
    scope: row.userId === null ? "instance" : "user",
    kind: row.kind as ProviderKind,
    label: row.label,
    baseUrl: row.baseUrl,
    keyLast4: row.keyLast4,
    models: row.models,
    contextWindow: row.contextWindow,
    capabilities: row.capabilities,
    status: row.status as ProviderStatus,
    authFailed: row.authFailed,
    lastTestedAt: row.lastTestedAt,
  };
}

const notFound = () => new NotFoundError("Provider not found");

async function loadRow(db: Db, id: string): Promise<Row | null> {
  const [row] = await db
    .select()
    .from(schema.providerConfigs)
    .where(eq(schema.providerConfigs.id, id));
  return row ?? null;
}

/** User-scope rows are visible only to their owner; instance rows need an admin. */
async function loadAccessible(db: Db, actor: Actor, id: string): Promise<Row> {
  const row = await loadRow(db, id);
  if (!row) throw notFound();
  if (row.userId === null) await assertAdmin(db, actor.userId);
  else if (row.userId !== actor.userId) throw notFound();
  return row;
}

async function loadOwned(db: Db, userId: string, id: string): Promise<Row> {
  const row = await loadRow(db, id);
  if (!row || row.userId !== userId) throw notFound();
  return row;
}

function validate(input: ProviderConfigInput): void {
  const label = input.label.trim();
  if (label.length < 1 || label.length > 60) {
    throw new ValidationError("Label must be 1 to 60 characters.");
  }
  for (const role of ["main", "fast"] as const) {
    const len = input.models[role].trim().length;
    if (len < 1 || len > 200) {
      throw new ValidationError(`The ${role} model name must be 1 to 200 characters.`);
    }
  }
  if (input.models.embedding !== undefined && input.models.embedding.trim().length > 200) {
    throw new ValidationError("The embedding model name must be at most 200 characters.");
  }
  const compatible = input.kind === "openai_compatible";
  if (input.contextWindow !== undefined) {
    if (!compatible) {
      throw new ValidationError("A context window is only used for OpenAI-compatible endpoints.");
    }
    if (
      !Number.isInteger(input.contextWindow) ||
      input.contextWindow < 1024 ||
      input.contextWindow > 10_000_000
    ) {
      throw new ValidationError("Context window must be a whole number from 1,024 to 10,000,000.");
    }
  }
  if (compatible && !input.baseUrl?.trim()) {
    throw new ValidationError("Enter the base URL of the endpoint.");
  }
  if (!compatible && input.baseUrl !== undefined && input.baseUrl.trim() !== "") {
    throw new ValidationError("A base URL is only used for OpenAI-compatible endpoints.");
  }
  if (
    input.kind === "anthropic" &&
    input.models.embedding &&
    !input.models.embeddingProviderConfigId
  ) {
    throw new ValidationError(
      "Anthropic has no embedding models. Choose another provider for embeddings.",
    );
  }
}

async function validateEmbeddingRef(
  db: Db,
  ownerId: string | null,
  input: ProviderConfigInput,
  selfId: string | undefined,
): Promise<void> {
  const refId = input.models.embeddingProviderConfigId;
  if (!refId) return;
  const kind = refId === selfId ? input.kind : (await loadRow(db, refId))?.kind;
  const ref = refId === selfId ? { userId: ownerId } : await loadRow(db, refId);
  if (!ref || ref.userId !== ownerId || kind === "anthropic") {
    throw new ValidationError(
      "The embedding provider must be one of your own non-Anthropic providers.",
    );
  }
}

export async function saveProviderConfig(
  deps: LlmDeps,
  actor: Actor,
  input: ProviderConfigInput & { id?: string; scope: "user" | "instance" },
): Promise<ProviderConfigView> {
  const { db, config } = deps;
  if (input.scope === "instance") await assertAdmin(db, actor.userId);
  const ownerId = input.scope === "instance" ? null : actor.userId;

  let existing: Row | null = null;
  if (input.id) {
    existing = await loadRow(db, input.id);
    if (!existing || existing.userId !== ownerId) throw notFound();
  }

  validate(input);
  const kind = input.kind;
  const baseUrl = kind === "openai_compatible" ? (input.baseUrl?.trim() ?? null) : null;
  if (kind === "openai_compatible" && baseUrl) {
    await checkCustomEndpoint(config, actor.role, baseUrl);
  }
  await validateEmbeddingRef(db, ownerId, input, existing?.id);

  const newKey = input.apiKey?.trim() || undefined;
  const sameTarget = existing !== null && existing.kind === kind && existing.baseUrl === baseUrl;
  const id = existing?.id ?? randomUUID();
  let encryptedKey: string | null;
  let keyLast4: string | null;
  if (newKey) {
    encryptedKey = encryptSecret(loadKeyring(config), newKey, id);
    keyLast4 = newKey.length >= 8 ? newKey.slice(-4) : null;
  } else if (existing && sameTarget) {
    encryptedKey = existing.encryptedKey;
    keyLast4 = existing.keyLast4;
  } else {
    if (kind !== "openai_compatible") throw new ValidationError("Enter an API key.");
    encryptedKey = null;
    keyLast4 = null;
  }

  const models: ProviderModels = {
    main: input.models.main.trim(),
    fast: input.models.fast.trim(),
    ...(input.models.embedding ? { embedding: input.models.embedding.trim() } : {}),
    ...(input.models.embeddingProviderConfigId
      ? { embeddingProviderConfigId: input.models.embeddingProviderConfigId }
      : {}),
  };
  const contextWindow = kind === "openai_compatible" ? (input.contextWindow ?? null) : null;
  const fields = {
    kind,
    label: input.label.trim(),
    baseUrl,
    encryptedKey,
    keyLast4,
    models,
    contextWindow,
  };

  if (!existing) {
    const [row] = await db
      .insert(schema.providerConfigs)
      .values({ id, userId: ownerId, ...fields })
      .returning();
    if (!row) throw new Error("provider_configs insert returned no row");
    return toView(row);
  }

  const reset =
    !sameTarget ||
    newKey !== undefined ||
    existing.models.main !== models.main ||
    existing.models.fast !== models.fast;
  const [row] = await db
    .update(schema.providerConfigs)
    .set({
      ...fields,
      ...(reset
        ? { status: "untested", capabilities: null, authFailed: false }
        : existing.capabilities && existing.contextWindow !== contextWindow
          ? {
              capabilities: {
                ...existing.capabilities,
                contextWindow: contextWindowFor(kind, models.main, contextWindow),
              },
            }
          : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(schema.providerConfigs.id, id))
    .returning();
  if (!row) throw notFound();
  return toView(row);
}

export async function testProviderConfig(
  deps: LlmDeps,
  actor: Actor,
  id: string,
): Promise<ProviderConfigView & { checks: ProbeChecks }> {
  const { db, config } = deps;
  const row = await loadAccessible(db, actor, id);
  if (row.kind === "openai_compatible" && row.baseUrl) {
    await checkCustomEndpoint(config, actor.role, row.baseUrl);
  }
  let apiKey: string | null = null;
  if (row.encryptedKey) {
    try {
      apiKey = decryptSecret(loadKeyring(config), row.encryptedKey, row.id);
    } catch (err) {
      if (!(err instanceof SecretDecryptError)) throw err;
      throw new ValidationError(
        "The stored key can't be decrypted (the encryption key changed). Enter the API key again.",
      );
    }
  }
  const { capabilities, status, checks, authRejected } = await probeCapabilities(deps, {
    id: row.id,
    kind: row.kind as ProviderKind,
    baseUrl: row.baseUrl,
    apiKey,
    models: row.models,
    contextWindow: row.contextWindow,
    capabilities: row.capabilities,
    userId: actor.userId,
  });
  const updated = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(schema.providerConfigs)
      .set({
        capabilities,
        status,
        authFailed: authRejected,
        lastTestedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.providerConfigs.id, id))
      .returning();
    if (status === "unsupported") {
      await tx
        .update(schema.userSettings)
        .set({ providerConfigId: null, updatedAt: sql`now()` })
        .where(eq(schema.userSettings.providerConfigId, id));
    }
    return r;
  });
  if (!updated) throw notFound();
  return { ...toView(updated), checks };
}

export async function listProviderConfigs(db: Db, userId: string): Promise<ProviderConfigView[]> {
  const rows = await db
    .select()
    .from(schema.providerConfigs)
    .where(eq(schema.providerConfigs.userId, userId))
    .orderBy(asc(schema.providerConfigs.createdAt));
  return rows.map(toView);
}

export async function activateProviderConfig(db: Db, userId: string, id: string): Promise<void> {
  const row = await loadOwned(db, userId, id);
  if ((row.status !== "full" && row.status !== "degraded") || row.authFailed) {
    throw new ValidationError("Run a successful capability test before activating this provider.");
  }
  await db
    .insert(schema.userSettings)
    .values({ userId, providerConfigId: id })
    .onConflictDoUpdate({
      target: schema.userSettings.userId,
      set: { providerConfigId: id, updatedAt: sql`now()` },
    });
}

/** user_settings.provider_config_id is set null by the foreign key. */
export async function deleteProviderConfig(db: Db, userId: string, id: string): Promise<void> {
  await loadOwned(db, userId, id);
  await db
    .delete(schema.providerConfigs)
    .where(and(eq(schema.providerConfigs.id, id), eq(schema.providerConfigs.userId, userId)));
}

async function currentInstanceId(db: Db): Promise<string | null> {
  const [inst] = await db
    .select({ id: schema.instanceSettings.instanceProviderConfigId })
    .from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1));
  return inst?.id ?? null;
}

export async function getInstanceProviderConfig(
  db: Db,
  actorId: string,
): Promise<ProviderConfigView | null> {
  await assertAdmin(db, actorId);
  const id = await currentInstanceId(db);
  const row = id ? await loadRow(db, id) : null;
  return row && row.userId === null ? toView(row) : null;
}

export async function setInstanceProviderConfig(
  deps: LlmDeps,
  actorId: string,
  input: ProviderConfigInput,
): Promise<ProviderConfigView> {
  await assertAdmin(deps.db, actorId);
  const view = await saveProviderConfig(
    deps,
    { userId: actorId, role: "admin" },
    { ...input, id: (await currentInstanceId(deps.db)) ?? undefined, scope: "instance" },
  );
  await deps.db
    .update(schema.instanceSettings)
    .set({ instanceProviderConfigId: view.id })
    .where(eq(schema.instanceSettings.id, 1));
  return view;
}

export async function getProviderStatusForUser(
  db: Db,
  userId: string,
): Promise<{
  source: "user" | "instance" | "none";
  authFailed: boolean;
  status: ProviderStatus | null;
}> {
  const picked = await pickProviderRow(db, userId);
  if (!picked) return { source: "none", authFailed: false, status: null };
  return {
    source: picked.source,
    authFailed: picked.row.authFailed,
    status: picked.row.status as ProviderStatus,
  };
}
