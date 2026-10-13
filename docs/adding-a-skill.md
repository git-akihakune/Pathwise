# Adding a skill

Skills extend the same coach persona. Read [architecture](architecture.md) and the [agent design](superpowers/specs/2026-10-12-pathwise-design.md) before changing behavior. User data must be accessed through scoped core services; agent writes create Proposals for approval.

## Registry contract

[agent/registry.ts](../packages/core/src/agent/registry.ts) defines this interface (the referenced types are exported there):

```ts
export interface Skill {
  id: SkillId;
  description: string;
  workflowOnly?: boolean;
  promptFragment(ctx: SkillContext): string;
  tools(ctx: SkillContext): ToolSet;
  contextProviders?: ContextProvider[];
}
```

`SkillContext` contains `deps` (`db`, `config`), `llm`, `userId`, `sessionId`, `messageId`, and `timezone`. A context provider has `id`, `maxTokens`, and `render(ctx): Promise<string>`. `registerSkill(skill: Skill): void` stores a skill; registering an existing id replaces it. `description` feeds the fast-model classifier. Tool names must be distinct: a later selected skill wins a name collision.

To add `networking`, extend the `SkillId` union in `registry.ts`, create `agent/skills/networking.ts`, and add `import "./networking"` to [skills/index.ts](../packages/core/src/agent/skills/index.ts). Add `"networking"` to `CANONICAL` in [select.ts](../packages/core/src/agent/select.ts), which controls the selected skill order; without it the free-chat selector drops the skill. The existing classifier discovers registered descriptions and filters results to known skill ids. Adjust `SCREEN_SKILLS` only if the approved design needs a screen hint. A workflow-only skill must also be excluded from free-chat selection (`WORKFLOW_ONLY`).

## Worked example: networking

This is a proposed extension, not a shipped feature. After extending `SkillId`, the following module uses current APIs to read the user's profile and propose a remembered networking preference. It performs no direct profile or memory mutation.

```ts
// packages/core/src/agent/skills/networking.ts
import { tool } from "ai";
import { z } from "zod";
import { getProfile } from "../../services/profile";
import { createProposal } from "../../services/proposals";
import { registerSkill } from "../registry";

registerSkill({
  id: "networking",
  description: "Explore networking preferences and prepare an introduction grounded in the profile.",
  promptFragment: () =>
    "Ask who the user wants to meet. Read their profile for evidence; never invent contacts. Ask before remembering a preference.",
  tools: (ctx) => ({
    getNetworkingBackground: tool({
      description: "Read the user's experience, education, and skills for an introduction.",
      inputSchema: z.object({}),
      execute: () => getProfile(ctx.deps.db, ctx.userId),
    }),
    proposeNetworkingPreference: tool({
      description: "Propose remembering a networking preference; user approval is required.",
      inputSchema: z.object({ content: z.string().min(1).max(1000) }),
      execute: async ({ content }) => {
        const proposal = await createProposal(ctx.deps.db, ctx.userId, {
          kind: "memory_add",
          payload: { category: "preference", content, sensitive: false },
          sessionId: ctx.sessionId,
          messageId: ctx.messageId,
        });
        return { proposalId: proposal.id };
      },
    }),
  }),
});
```

For editing existing entities, use their supported Proposal kind and version contract. `createProposal` captures target versions; approval checks ownership and staleness. Do not call `addMemory`, profile updates, or other mutating services from a write tool. Use plain Zod tool schemas and let Proposal validation enforce the domain payload.

## Deterministic fixtures and tests

[registerMockFixture](../packages/core/src/llm/mock/registry.ts) accepts a purpose plus `(call: MockCall) => MockReply`; replies are `{ text }`, `{ json }`, or `{ toolCalls, text? }`. `call` includes `lastUserText`, `system`, `toolNames`, `role`, and `purpose`.

Add a `networking` branch to the existing classifier fixture and a trigger such as **“remember my networking preference”** to the chat fixture in [coach.ts](../packages/core/src/llm/mock/fixtures/coach.ts). For classifier matching, use the file's `latestText(call)` helper, since the latest message is wrapped after history. Preserve the current distress and other skill branches. If adding a separate fixture module, import it from [fixtures/index.ts](../packages/core/src/llm/mock/fixtures/index.ts) and delegate unmatched inputs to the existing fixture: registration replaces rather than chains fixtures.

This registration example delegates to the built-in chat fixture; the classifier branch selecting `networking` must be added separately:

```ts
import { chatFixture } from "./coach";
import { registerMockFixture } from "../registry";

registerMockFixture("chat", (call) => {
  if (
    /remember my networking preference/i.test(call.lastUserText) &&
    call.toolNames.includes("proposeNetworkingPreference")
  ) {
    return {
      toolCalls: [{
        toolName: "proposeNetworkingPreference",
        input: { content: "I prefer small professional meetups." },
      }],
      text: "This preference waits for your approval.",
    };
  }
  return chatFixture(call);
});
```

Write tests before implementation:

- Unit: selection/stickiness, registry/tool merging, prompt guardrails, and mock trigger behavior without breaking distress handling.
- Integration: the read tool returns only the owner’s profile; the proposal tool creates a pending Proposal without changing memory; approval applies it; foreign targets and stale versions are rejected for update tools.
- Turn integration: classifier selects the new skill; streamed tool parts contain the Proposal id; unsupported tool capability uses the text-only path.
- E2E with `LLM_MODE=mock`: send the trigger, see the approval card, approve it, and verify the Profile preference. No LLM keys are allowed in CI.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for commands and test layers.
