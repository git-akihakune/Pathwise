"use server";

import { ValidationError } from "@pathwise/core/errors";
import type { ProbeChecks, ProviderKind, ProviderStatus } from "@pathwise/core/llm";
import {
  activateProviderConfig,
  deleteProviderConfig,
  type ProviderConfigInput,
  saveProviderConfig,
  testProviderConfig,
} from "@pathwise/core/services/providers";
import { updateUserSettings } from "@pathwise/core/services/settings";
import { revalidatePath } from "next/cache";
import { toFormError } from "@/lib/form-error";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";

export type ProviderFormState =
  | {
      error?: string;
      result?: { label: string; status: ProviderStatus; checks: ProbeChecks };
    }
  | undefined;

export type CoachSettingsState = { error?: string; saved?: boolean } | undefined;

const KINDS: readonly string[] = [
  "anthropic",
  "openai",
  "google",
  "openai_compatible",
] satisfies ProviderKind[];

const text = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();
const optional = (fd: FormData, name: string) => text(fd, name) || undefined;

function parseInput(fd: FormData): ProviderConfigInput & { id?: string } {
  const kind = text(fd, "kind");
  if (!KINDS.includes(kind)) throw new ValidationError("Choose a provider.");
  const embeddingRef = text(fd, "embeddingProviderConfigId");
  const contextWindow = optional(fd, "contextWindow");
  return {
    id: optional(fd, "id"),
    kind: kind as ProviderKind,
    label: text(fd, "label"),
    baseUrl: optional(fd, "baseUrl"),
    // An empty field means "keep the stored key".
    apiKey: optional(fd, "apiKey"),
    models: {
      main: text(fd, "mainModel"),
      fast: text(fd, "fastModel"),
      embedding: optional(fd, "embeddingModel"),
      embeddingProviderConfigId: embeddingRef && embeddingRef !== "self" ? embeddingRef : undefined,
    },
    contextWindow: contextWindow === undefined ? undefined : Number(contextWindow),
  };
}

export async function saveProviderAction(
  _prev: ProviderFormState,
  fd: FormData,
): Promise<ProviderFormState> {
  const { userId, role } = await requireSession();
  const deps = getServer();
  const actor = { userId, role };
  let configId = optional(fd, "id");
  try {
    const saved = await saveProviderConfig(deps, actor, { ...parseInput(fd), scope: "user" });
    configId = saved.id;
    const { checks, status, label } = await testProviderConfig(deps, actor, saved.id);
    return { result: { label, status, checks } };
  } catch (e) {
    return toFormError(e, { configId });
  } finally {
    revalidatePath("/", "layout");
  }
}

export async function testProviderAction(id: string): Promise<ProviderFormState> {
  const { userId, role } = await requireSession();
  try {
    const { checks, status, label } = await testProviderConfig(getServer(), { userId, role }, id);
    return { result: { label, status, checks } };
  } catch (e) {
    return toFormError(e, { configId: id });
  } finally {
    revalidatePath("/", "layout");
  }
}

export async function activateProviderAction(id: string): Promise<ProviderFormState> {
  const { userId } = await requireSession();
  try {
    await activateProviderConfig(getServer().db, userId, id);
    return undefined;
  } catch (e) {
    return toFormError(e, { configId: id });
  } finally {
    revalidatePath("/", "layout");
  }
}

export async function deleteProviderAction(id: string): Promise<ProviderFormState> {
  const { userId } = await requireSession();
  try {
    await deleteProviderConfig(getServer().db, userId, id);
    return undefined;
  } catch (e) {
    return toFormError(e, { configId: id });
  } finally {
    revalidatePath("/", "layout");
  }
}

export async function saveCoachSettingsAction(
  _prev: CoachSettingsState,
  fd: FormData,
): Promise<CoachSettingsState> {
  const { userId } = await requireSession();
  try {
    await updateUserSettings(getServer().db, userId, {
      bluntness: Number(fd.get("bluntness")) as 1 | 2 | 3 | 4 | 5,
      timezone: text(fd, "timezone") || null,
    });
    return { saved: true };
  } catch (e) {
    return toFormError(e);
  } finally {
    revalidatePath("/", "layout");
  }
}
