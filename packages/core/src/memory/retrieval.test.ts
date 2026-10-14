import { expect, it } from "vitest";
import { rrfFuse, toOrTsQuery } from "./retrieval";

it("sums 1/(k + rank) across lists (k = 60)", () =>
  expect(
    rrfFuse([
      [{ id: "x" }, { id: "y" }, { id: "z" }],
      [{ id: "y" }, { id: "w" }],
    ]),
  ).toEqual(["y", "x", "w", "z"]));
it("keeps first-seen order on ties", () =>
  expect(rrfFuse([[{ id: "a" }], [{ id: "b" }]])).toEqual(["a", "b"]));
it("builds an OR query of distinct words of 3+ letters", () => {
  expect(toOrTsQuery("What jobs suit my love of drawing? Drawing!")).toBe(
    "what | jobs | suit | love | drawing",
  );
  expect(toOrTsQuery("C++ & (it)")).toBeNull();
});
