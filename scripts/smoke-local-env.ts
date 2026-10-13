export interface SmokeEnv {
  baseUrl: string;
  model: string;
  apiKey: string | undefined;
}

export function parseSmokeEnv(env: NodeJS.ProcessEnv): SmokeEnv | { error: string } {
  const baseUrl = env.LOCAL_LLM_BASE_URL?.replace(/\/+$/, "");
  if (!baseUrl || !URL.canParse(baseUrl) || !/^https?:$/.test(new URL(baseUrl).protocol)) {
    return {
      error:
        "Set LOCAL_LLM_BASE_URL to your OpenAI-compatible server, e.g. LOCAL_LLM_BASE_URL=http://localhost:8080/v1 pnpm smoke:local",
    };
  }
  return {
    baseUrl,
    model: env.LOCAL_LLM_MODEL || "local-model",
    apiKey: env.LOCAL_LLM_API_KEY || undefined,
  };
}
