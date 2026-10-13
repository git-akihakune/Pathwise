import { expect, it } from "vitest";
import { parseSmokeEnv } from "./smoke-local-env";

it.each([
  {},
  { LOCAL_LLM_BASE_URL: "" },
  { LOCAL_LLM_BASE_URL: "localhost:8080" },
  { LOCAL_LLM_BASE_URL: "ftp://localhost:8080/v1" },
  { LOCAL_LLM_BASE_URL: "http://" },
])("rejects %o with a usage hint", (env) => {
  expect(parseSmokeEnv(env)).toEqual({
    error: expect.stringMatching(/LOCAL_LLM_BASE_URL=http:\/\/localhost:8080\/v1/),
  });
});

it("defaults the model, keeps the key optional, and honours overrides", () => {
  expect(parseSmokeEnv({ LOCAL_LLM_BASE_URL: "http://localhost:8080/v1/" })).toEqual({
    baseUrl: "http://localhost:8080/v1",
    model: "local-model",
    apiKey: undefined,
  });
  expect(
    parseSmokeEnv({
      LOCAL_LLM_BASE_URL: "http://h:1/v1",
      LOCAL_LLM_MODEL: "gemma-3-4b",
      LOCAL_LLM_API_KEY: "k",
    }),
  ).toEqual({ baseUrl: "http://h:1/v1", model: "gemma-3-4b", apiKey: "k" });
});

it("treats empty optional values as unset and strips all trailing slashes", () => {
  expect(
    parseSmokeEnv({
      LOCAL_LLM_BASE_URL: "https://localhost:8080/v1///",
      LOCAL_LLM_MODEL: "",
      LOCAL_LLM_API_KEY: "",
    }),
  ).toEqual({ baseUrl: "https://localhost:8080/v1", model: "local-model", apiKey: undefined });
});
