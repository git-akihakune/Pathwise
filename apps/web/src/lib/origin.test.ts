import { expect, it } from "vitest";
import { originMismatch } from "./origin";

it.each([
  ["http://localhost:3000", "http://localhost:3000", false],
  ["http://localhost:3000", "http://localhost:3000/", false],
  ["https://coach.example.com", "https://COACH.example.com", false],
  ["http://localhost:3000", "http://192.168.1.20:3000", true],
  ["http://localhost:3000", "http://localhost:3100", true],
])("%s vs %s → %s", (appUrl, origin, expected) => {
  expect(originMismatch(appUrl, origin)).toBe(expected);
});
