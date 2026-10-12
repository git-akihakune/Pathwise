import { describe, expect, it } from "vitest";
import { isDate, mondayOf, weekStartOf } from "./week";

describe("mondayOf (Review Focus 2)", () => {
  it.each([
    ["2026-10-11T23:30:00Z", "UTC", "2026-10-05"],
    ["2026-10-11T23:30:00Z", "Pacific/Auckland", "2026-10-12"], // Monday 12:30 local
    ["2026-10-12T03:00:00Z", "America/Los_Angeles", "2026-10-05"], // Sunday 20:00 local
    ["2026-11-02T07:30:00Z", "America/Los_Angeles", "2026-10-26"], // Sunday 23:30 PST, the day DST ended
    ["2026-11-02T08:30:00Z", "America/Los_Angeles", "2026-11-02"], // Monday 00:30 PST
    ["2026-03-29T22:30:00Z", "Europe/London", "2026-03-23"], // Sunday 23:30 BST, the day DST began
    ["2026-03-29T23:30:00Z", "Europe/London", "2026-03-30"], // Monday 00:30 BST
  ])("%s in %s -> %s", (iso, tz, expected) => {
    expect(mondayOf(new Date(iso), tz)).toBe(expected);
  });
});

describe("weekStartOf", () => {
  it.each([
    ["2026-10-12", "2026-10-12"],
    ["2026-10-14", "2026-10-12"],
    ["2026-10-18", "2026-10-12"],
    ["2027-01-01", "2026-12-28"],
  ])("weekStartOf(%s) = %s", (d, expected) => {
    expect(weekStartOf(d)).toBe(expected);
  });
});

describe("isDate", () => {
  it.each([
    ["2026-02-28", true],
    ["2028-02-29", true],
    ["2026-02-30", false],
    ["2026-04-31", false],
    ["2026-13-01", false],
    ["2026-02-32", false],
  ])("%s -> %s", (s, ok) => {
    expect(isDate(s)).toBe(ok);
  });
});
