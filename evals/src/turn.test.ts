import type { TurnDeps, TurnResult } from "@pathwise/core/agent";
import { runTurn } from "@pathwise/core/agent";
import { recentMessages } from "@pathwise/core/services/sessions";
import { beforeEach, expect, it, vi } from "vitest";
import { collectTurn } from "./live";

vi.mock("@pathwise/core/agent", () => ({ runTurn: vi.fn() }));
vi.mock("@pathwise/core/services/sessions", () => ({ recentMessages: vi.fn() }));
const deps = {} as TurnDeps;
const final: TurnResult = {
  sessionId: "s",
  assistantMessageId: "a",
  status: "complete",
  text: "Grounded reply",
  safety: false,
};
beforeEach(() => vi.resetAllMocks());
function response(chunks: object[], result: TurnResult | undefined, status = 200) {
  vi.mocked(runTurn).mockImplementation(
    async (_deps, _input, hooks) =>
      new Response(
        new ReadableStream({
          async start(controller) {
            for (const chunk of chunks)
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
            await hooks?.onTurnEnd?.(result as TurnResult);
            controller.close();
          },
        }),
        { status },
      ),
  );
}
it("waits for finalization and reads tool names from the persisted assistant parts", async () => {
  response([{ type: "text-delta", delta: "Grounded reply" }], final);
  vi.mocked(recentMessages).mockResolvedValue([
    {
      id: "a",
      role: "assistant",
      parts: [
        { type: "text", text: "Grounded reply" },
        {
          type: "tool-propose_plan",
          toolCallId: "t",
          state: "output-available",
          input: {},
          output: {},
        },
        {
          type: "dynamic-tool",
          toolName: "lookup_occupation",
          toolCallId: "u",
          state: "input-available",
          input: {},
        },
      ],
    },
  ]);
  expect(await collectTurn(deps, "u", "hello")).toEqual({
    role: "assistant",
    text: "Grounded reply",
    toolCalls: ["propose_plan", "lookup_occupation"],
  });
  expect(vi.mocked(runTurn).mock.calls[0]?.[1].message.id).toMatch(/^[\da-f-]{36}$/);
});
it.each([
  [[{ type: "error", errorText: "stream failed" }], final, 200, "stream failed"],
  [[{ type: "finish", finishReason: "error" }], final, 200, "failed"],
  [[], { ...final, status: "interrupted" }, 200, "interrupted"],
  [[], undefined, 200, "finalization"],
  [[], final, 503, "HTTP 503"],
] as const)(
  "refuses to judge an unsuccessful response %o",
  async (chunks, result, status, error) => {
    response([...chunks], result as TurnResult | undefined, status);
    await expect(collectTurn(deps, "u", "hello")).rejects.toThrow(error);
  },
);
it("detects failed persistence even when the stream says complete", async () => {
  response([], final);
  vi.mocked(recentMessages).mockResolvedValue([]);
  await expect(collectTurn(deps, "u", "hello")).rejects.toThrow("persisted");
});

import { createCredentialUser } from "@pathwise/core/auth";
import type { Llm } from "@pathwise/core/llm";
import { generateStructured } from "@pathwise/core/llm";
import { evaluateCase } from "./live";
import { PERSONAS } from "./personas";
import { SCENARIOS } from "./scenarios";
import { simulateUserReply } from "./simulate";

vi.mock("@pathwise/core/auth", () => ({
  createCredentialUser: vi.fn(),
  createAuth: vi.fn(),
  signUp: vi.fn(),
}));
vi.mock("@pathwise/core/seed", () => ({ applyPersona: vi.fn() }));
vi.mock("@pathwise/core/llm", () => ({ generateStructured: vi.fn(), requireLlm: vi.fn() }));
vi.mock("@pathwise/core/services/proposals", () => ({ listProposals: vi.fn() }));
vi.mock("./simulate", () => ({ simulateUserReply: vi.fn() }));
it("returns an errored unscored case rather than judging an interrupted turn", async () => {
  const persona = PERSONAS[0],
    scenario = SCENARIOS[4];
  if (!persona || !scenario) throw new Error("Missing fixture");
  vi.mocked(createCredentialUser).mockResolvedValue({ userId: "u", password: "unused" });
  response([], { ...final, status: "interrupted" });
  const result = await evaluateCase(deps, {} as Llm, persona, scenario);
  expect(result).toEqual({
    persona: persona.id,
    scenario: scenario.id,
    transcript: [{ role: "user", text: scenario.opening }],
    proposals: [],
    scores: {},
    error: "Turn interrupted",
  });
  expect(generateStructured).not.toHaveBeenCalled();
});
it("keeps completed transcript evidence if simulated follow-up fails", async () => {
  const persona = PERSONAS[0],
    scenario = SCENARIOS[4];
  if (!persona || !scenario) throw new Error("Missing fixture");
  vi.mocked(createCredentialUser).mockResolvedValue({ userId: "u", password: "unused" });
  response([], final);
  vi.mocked(recentMessages).mockResolvedValue([
    { id: "a", role: "assistant", parts: [{ type: "text", text: "Grounded reply" }] },
  ]);
  vi.mocked(simulateUserReply).mockRejectedValue(new Error("simulation failed"));
  const result = await evaluateCase(deps, {} as Llm, persona, scenario);
  expect(result.transcript).toEqual([
    { role: "user", text: scenario.opening },
    { role: "assistant", text: "Grounded reply", toolCalls: [] },
  ]);
  expect(result.error).toBe("simulation failed");
  expect(result.scores).toEqual({});
  expect(generateStructured).not.toHaveBeenCalled();
});

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { TAXONOMY_DIR } from "./live";

it("resolves bundled taxonomy at the actual repository root", () => {
  expect(TAXONOMY_DIR).toBe(resolve(process.cwd(), "data/taxonomy"));
  expect(existsSync(resolve(TAXONOMY_DIR, "manifest.json"))).toBe(true);
});
