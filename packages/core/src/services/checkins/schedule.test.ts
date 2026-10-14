import { describe, expect, it } from "vitest";
import { checkinWeekOf, computeDueAt, nextDueAt } from "./schedule";

const s = (timezone: string | null, checkinDay: number, checkinTime: string) => ({
  timezone,
  checkinDay,
  checkinTime,
});

describe("computeDueAt (Review Focus 1)", () => {
  it.each([
    [
      "UTC default, mid-week",
      s(null, 0, "18:00"),
      "2026-10-14T12:00:00Z",
      "2026-10-18T18:00:00.000Z",
      "2026-10-12",
    ],
    [
      "New York, spring-forward Sunday",
      s("America/New_York", 0, "18:00"),
      "2026-03-04T12:00:00Z",
      "2026-03-08T22:00:00.000Z",
      "2026-03-02",
    ],
    [
      "New York, fall-back Sunday",
      s("America/New_York", 0, "18:00"),
      "2026-10-28T12:00:00Z",
      "2026-11-01T23:00:00.000Z",
      "2026-10-26",
    ],
    [
      "New York, 02:30 doesn't exist → 03:30 EDT",
      s("America/New_York", 0, "02:30"),
      "2026-03-04T12:00:00Z",
      "2026-03-08T07:30:00.000Z",
      "2026-03-02",
    ],
    [
      "New York, 01:30 happens twice → first",
      s("America/New_York", 0, "01:30"),
      "2026-10-28T12:00:00Z",
      "2026-11-01T05:30:00.000Z",
      "2026-10-26",
    ],
    [
      "Berlin, spring-forward Sunday",
      s("Europe/Berlin", 0, "18:00"),
      "2026-03-25T12:00:00Z",
      "2026-03-29T16:00:00.000Z",
      "2026-03-23",
    ],
    [
      "Berlin, fall-back Sunday",
      s("Europe/Berlin", 0, "18:00"),
      "2026-10-21T12:00:00Z",
      "2026-10-25T17:00:00.000Z",
      "2026-10-19",
    ],
    [
      "Berlin, 02:30 on spring-forward day → 03:30 CEST",
      s("Europe/Berlin", 0, "02:30"),
      "2026-03-25T12:00:00Z",
      "2026-03-29T01:30:00.000Z",
      "2026-03-23",
    ],
    [
      "Auckland, already Sunday while UTC says Saturday",
      s("Pacific/Auckland", 0, "18:00"),
      "2026-09-26T20:00:00Z",
      "2026-09-27T05:00:00.000Z",
      "2026-09-21",
    ],
    [
      "Auckland, Monday morning is a new week",
      s("Pacific/Auckland", 0, "18:00"),
      "2026-09-27T20:00:00Z",
      "2026-10-04T05:00:00.000Z",
      "2026-09-28",
    ],
    [
      "Auckland, 02:30 twice on fall-back → first",
      s("Pacific/Auckland", 0, "02:30"),
      "2026-04-01T00:00:00Z",
      "2026-04-04T13:30:00.000Z",
      "2026-03-30",
    ],
    [
      "Monday 09:00, earlier in the same week",
      s("Europe/Berlin", 1, "09:00"),
      "2026-10-14T12:00:00Z",
      "2026-10-12T07:00:00.000Z",
      "2026-10-12",
    ],
  ])("%s", (_name, settings, now, due, weekOf) => {
    const d = computeDueAt(settings, new Date(now));
    expect(d.toISOString()).toBe(due);
    expect(checkinWeekOf(d, settings.timezone ?? "UTC")).toBe(weekOf);
  });
});

it("nextDueAt rolls to the following week once this week's time has passed", () => {
  expect(
    nextDueAt(s("Europe/Berlin", 1, "09:00"), new Date("2026-10-14T12:00:00Z")).toISOString(),
  ).toBe("2026-10-19T07:00:00.000Z");
  expect(nextDueAt(s(null, 0, "18:00"), new Date("2026-10-14T12:00:00Z")).toISOString()).toBe(
    "2026-10-18T18:00:00.000Z",
  );
});
