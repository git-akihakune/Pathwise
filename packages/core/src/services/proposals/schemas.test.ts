import { expect, it } from "vitest";
import { proposalPayloadSchemas as S } from "./schemas";

it.each([
  ["memory_add", { category: "value", content: "Autonomy", sensitive: false }, true],
  ["memory_add", { category: "value", content: "", sensitive: false }, false],
  ["memory_update", { id: "8f0b4c1e-1d7a-4f43-9b6e-0d6f3c2a9e10" }, false], // nothing to change
  ["memory_update", { id: "8f0b4c1e-1d7a-4f43-9b6e-0d6f3c2a9e10", category: "fact" }, true],
  [
    "profile_update",
    { entity: "skill", op: "create", fields: { name: "SQL", level: "working" } },
    true,
  ],
  [
    "profile_update",
    { entity: "experience", op: "create", fields: { organization: "Acme" } },
    false,
  ], // no title
  ["profile_update", { entity: "experience", op: "update", fields: { title: "X" } }, false], // no id
  [
    "profile_update",
    { entity: "skill", op: "delete", id: "8f0b4c1e-1d7a-4f43-9b6e-0d6f3c2a9e10" },
    true,
  ],
  ["action_status_update", { updates: [] }, false],
  [
    "plan_create",
    { northStar: "N", milestones: [], actions: [{ title: "a", weekOf: "2026-10-13" }] },
    false,
  ], // Tuesday
  [
    "plan_change",
    {
      milestones: { add: [], update: [], remove: [] },
      actions: { add: [], update: [], remove: [] },
    },
    true,
  ],
] as const)("%s %o valid=%s", (kind, payload, ok) => {
  expect(S[kind].safeParse(payload).success).toBe(ok);
});

it("strips provenance from profile fields and rejects duplicate action ids", () => {
  const parsed = S.profile_update.parse({
    entity: "skill",
    op: "create",
    fields: { name: "SQL", sourceType: "cv", sourceId: "x" },
  });
  expect(parsed.fields).toEqual({ name: "SQL" });
  const id = "8f0b4c1e-1d7a-4f43-9b6e-0d6f3c2a9e10";
  const u = { actionId: id, status: "done", basedOnVersion: 1 };
  expect(S.action_status_update.safeParse({ updates: [u, u] }).success).toBe(false);
});
