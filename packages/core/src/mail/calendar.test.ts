import { expect, it } from "vitest";
import { calendarAction } from "./calendar";

const on = {
  checkinEnabled: true,
  emailEnabled: true,
  checkinDay: 0,
  checkinTime: "18:00",
  timezone: "UTC",
};
it.each([
  ["first explicit save of the default schedule", on, on, 0, true, "request"],
  ["saving again without changes", on, on, 1, true, null],
  ["changing the day", on, { ...on, checkinDay: 2 }, 1, true, "request"],
  [
    "timezone saved for the first time, no invite yet",
    on,
    { ...on, timezone: "Europe/Berlin" },
    0,
    false,
    null,
  ],
  [
    "timezone change after an invite",
    on,
    { ...on, timezone: "Europe/Berlin" },
    1,
    false,
    "request",
  ],
  [
    "turning check-ins off after an invite",
    on,
    { ...on, checkinEnabled: false },
    1,
    true,
    "cancel",
  ],
  ["turning email off after an invite", on, { ...on, emailEnabled: false }, 1, true, "cancel"],
  ["turning off before any invite", on, { ...on, checkinEnabled: false }, 0, true, null],
  ["turning back on after a cancel", { ...on, checkinEnabled: false }, on, 2, true, "request"],
] as const)("%s → %s", (_n, before, after, seq, explicitSave, expected) => {
  expect(calendarAction(before, after, seq, { explicitSave })).toBe(expected);
});
