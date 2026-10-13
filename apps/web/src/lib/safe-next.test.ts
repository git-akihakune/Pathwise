import { expect, it } from "vitest";
import { safeNext } from "./safe-next";

it.each([
  ["/checkin", "/checkin"],
  ["/checkin?step=wins", "/checkin?step=wins"],
  ["//evil.example.com", "/"],
  ["/\\evil.example.com", "/"],
  ["https://evil.example.com/checkin", "/"],
  ["/sign-in", "/"],
  ["", "/"],
  [null, "/"],
])("safeNext(%o) → %s (Review Focus 5)", (input, expected) => {
  expect(safeNext(input)).toBe(expected);
});

it.each([
  "/%2Fevil.com",
  "/%5Cevil.com",
  "javascript:alert(1)",
  "/\t/evil.com",
  "/%09/evil.com",
  "/%zz",
])("rejects %s", (input) => {
  expect(safeNext(input)).toBe("/");
});
