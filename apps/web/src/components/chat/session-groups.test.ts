import { expect, it } from "vitest";
import { groupBySession } from "./session-groups";

const m = (
  id: string,
  role: "user" | "assistant",
  sessionId?: string,
  topic: string | null = null,
) =>
  ({
    id,
    role,
    parts: [],
    metadata: sessionId
      ? {
          sessionId,
          sessionStartedAt: "2026-10-12T09:00:00.000Z",
          topic,
          createdAt: "2026-10-12T09:00:00.000Z",
          status: "complete",
        }
      : undefined,
  }) as never;
const shape = (g: ReturnType<typeof groupBySession>) =>
  g.map((x) => [x.sessionId, x.topic, x.messages.map((y) => y.id)]);

it("splits at session changes; a user message without metadata joins the next reply's session", () =>
  expect(
    shape(
      groupBySession([
        m("1", "user", "s1"),
        m("2", "assistant", "s1"),
        m("3", "user"),
        m("4", "assistant", "s2", "Salary"),
      ]),
    ),
  ).toEqual([
    ["s1", null, ["1", "2"]],
    ["s2", "Salary", ["3", "4"]],
  ]));
it("keeps a pending user message in the last group", () =>
  expect(shape(groupBySession([m("1", "user", "s1"), m("2", "user")]))).toEqual([
    ["s1", null, ["1", "2"]],
  ]));
