import { expect, it } from "vitest";
import { keywordDistress, maxDistress, SAFETY_RESPONSE } from "./distress";

it.each([
  ["I can't go on like this", "acute"],
  ["Honestly everyone would be better off dead without me", "acute"],
  ["I've been feeling suicidal", "acute"],
  ["I keep thinking about how to end my life", "acute"],
  ["I do not want to live anymore", "acute"],
  ["I dont want to be alive", "acute"],
  ["I cannot go on", "acute"],
  ["I'm completely burnt out", "elevated"],
  ["I feel hopeless about job hunting", "elevated"],
  ["This commute kills my motivation", "none"],
  ["I volunteer for a suicide prevention charity", "none"],
] as const)("%s → %s (Review Focus 1)", (text, level) => expect(keywordDistress(text)).toBe(level));

it("takes the more severe verdict", () => {
  expect(maxDistress("none", "acute")).toBe("acute");
  expect(maxDistress("elevated", "none")).toBe("elevated");
});
it("lists the instance's resources in the safety response", () => {
  const text = SAFETY_RESPONSE([
    { name: "Samaritans", url: "https://www.samaritans.org" },
    { name: "Find a Helpline", url: "https://findahelpline.com" },
  ]);
  expect(text).toContain(
    "- [Samaritans](https://www.samaritans.org)\n- [Find a Helpline](https://findahelpline.com)",
  );
  expect(text).toContain("contact your local emergency number now");
});
