import type { ProviderKind } from "@pathwise/core/llm";
export interface EvalEnv {
  kind: ProviderKind;
  apiKey?: string;
  baseUrl?: string;
  mainModel: string;
  fastModel: string;
  judgeModel: string;
}
export function parseEvalEnv(env: NodeJS.ProcessEnv): EvalEnv | { error: string } {
  const value = (key: string) => env[key]?.trim() || undefined;
  const kind = value("EVAL_PROVIDER_KIND");
  if (!kind || !["anthropic", "openai", "google", "openai_compatible"].includes(kind))
    return { error: "Set EVAL_PROVIDER_KIND to anthropic, openai, google, or openai_compatible." };
  const mainModel = value("EVAL_MAIN_MODEL"),
    fastModel = value("EVAL_FAST_MODEL"),
    judgeModel = value("EVAL_JUDGE_MODEL");
  for (const key of ["EVAL_MAIN_MODEL", "EVAL_FAST_MODEL", "EVAL_JUDGE_MODEL"])
    if (!value(key)) return { error: `Set ${key}.` };
  const apiKey = value("EVAL_API_KEY"),
    baseUrl = value("EVAL_BASE_URL");
  if (kind === "openai_compatible") {
    if (!baseUrl || !URL.canParse(baseUrl) || !/^https?:$/.test(new URL(baseUrl).protocol))
      return { error: "Set EVAL_BASE_URL to an HTTP(S) OpenAI-compatible endpoint." };
  } else {
    if (!apiKey) return { error: "Set EVAL_API_KEY for the selected provider." };
    if (baseUrl)
      return {
        error: "EVAL_BASE_URL is only supported with EVAL_PROVIDER_KIND=openai_compatible.",
      };
  }
  return {
    kind: kind as ProviderKind,
    mainModel: mainModel as string,
    fastModel: fastModel as string,
    judgeModel: judgeModel as string,
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}
