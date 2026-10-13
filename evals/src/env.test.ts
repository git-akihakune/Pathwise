import { expect, it } from "vitest";
import { parseEvalEnv } from "./env";

const base = {
  EVAL_PROVIDER_KIND: "openai_compatible",
  EVAL_BASE_URL: "http://localhost:11434/v1",
  EVAL_MAIN_MODEL: "m",
  EVAL_FAST_MODEL: "f",
  EVAL_JUDGE_MODEL: "j",
};
it("allows keyless local providers and trims unset values", () => {
  expect(parseEvalEnv({ ...base, EVAL_API_KEY: "   " })).toEqual({
    kind: "openai_compatible",
    baseUrl: base.EVAL_BASE_URL,
    mainModel: "m",
    fastModel: "f",
    judgeModel: "j",
  });
});
it.each([
  "EVAL_PROVIDER_KIND",
  "EVAL_MAIN_MODEL",
  "EVAL_FAST_MODEL",
  "EVAL_JUDGE_MODEL",
  "EVAL_BASE_URL",
])("names missing %s", (name) => {
  expect(parseEvalEnv({ ...base, [name]: " " })).toEqual({ error: expect.stringContaining(name) });
});
it.each(["anthropic", "google", "openai"])("requires a key for %s", (kind) => {
  expect(parseEvalEnv({ ...base, EVAL_PROVIDER_KIND: kind, EVAL_BASE_URL: undefined })).toEqual({
    error: expect.stringContaining("EVAL_API_KEY"),
  });
});
it.each(["ftp://localhost", "not-a-url"])("rejects invalid endpoint %s", (url) => {
  expect(parseEvalEnv({ ...base, EVAL_BASE_URL: url })).toEqual({
    error: expect.stringContaining("EVAL_BASE_URL"),
  });
});
it("rejects unknown kind without echoing secret values", () => {
  expect(parseEvalEnv({ ...base, EVAL_PROVIDER_KIND: "secret" })).toEqual({
    error: expect.stringContaining("EVAL_PROVIDER_KIND"),
  });
  expect(JSON.stringify(parseEvalEnv({ ...base, EVAL_PROVIDER_KIND: "secret" }))).not.toContain(
    "secret",
  );
});
