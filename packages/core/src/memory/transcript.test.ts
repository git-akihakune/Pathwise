import type { UIMessage } from "ai";
import { expect, it } from "vitest";
import { SAFETY_RESPONSE } from "../agent/distress";
import { renderTranscript } from "./transcript";

const msg = (role: "user" | "assistant", text: string): UIMessage => ({
  id: crypto.randomUUID(),
  role,
  parts: [{ type: "text", text }],
});

it("renders User/Coach lines", () => {
  expect(renderTranscript([msg("user", "hi"), msg("assistant", "hello")])).toBe(
    "User: hi\n\nCoach: hello",
  );
});
it("omits safety-response turns and the message that triggered them", () => {
  const safety = SAFETY_RESPONSE([{ name: "Find a Helpline", url: "https://findahelpline.com" }]);
  expect(
    renderTranscript([
      msg("user", "I like nursing"),
      msg("assistant", "Nice."),
      msg("user", "I want to end my life"),
      msg("assistant", safety),
      msg("user", "Back to work"),
    ]),
  ).toBe("User: I like nursing\n\nCoach: Nice.\n\nUser: Back to work");
});
