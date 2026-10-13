import { TZDate, tzOffset } from "@date-fns/tz";
import { mondayOf } from "../plan";
import type { UserSettings } from "../settings";

export type ScheduleSettings = Pick<UserSettings, "timezone" | "checkinDay" | "checkinTime">;

const HOUR = 3_600_000;

/**
 * The UTC instant at which the wall-clock `date` + `time` occurs in `timeZone`. A repeated local
 * time (fall back) resolves to its first occurrence; a skipped one (spring forward) shifts forward.
 */
export function zonedTimeToUtc(
  date: { year: number; month: number; day: number },
  time: string,
  timeZone: string,
): Date {
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(date.year, date.month - 1, date.day, hh, mm);
  const before = tzOffset(timeZone, new Date(wall - 36 * HOUR));
  const after = tzOffset(timeZone, new Date(wall + 36 * HOUR));
  const valid = [...new Set([before, after])]
    .map((o) => wall - o * 60_000)
    .filter((t) => wall - tzOffset(timeZone, new Date(t)) * 60_000 === t);
  return new Date(valid.length ? Math.min(...valid) : wall - before * 60_000);
}

/** The due moment in the local Monday–Sunday week containing `now`. */
export function computeDueAt(settings: ScheduleSettings, now: Date): Date {
  return dueInWeekOf(settings, now, 0);
}

function dueInWeekOf(settings: ScheduleSettings, now: Date, addDays: number): Date {
  const tz = settings.timezone ?? "UTC";
  const local = new TZDate(now, tz);
  const monday = Date.UTC(
    local.getFullYear(),
    local.getMonth(),
    local.getDate() - ((local.getDay() + 6) % 7) + addDays,
  );
  const target = new Date(
    monday + (settings.checkinDay === 0 ? 6 : settings.checkinDay - 1) * 24 * HOUR,
  );
  return zonedTimeToUtc(
    { year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate() },
    settings.checkinTime,
    tz,
  );
}

/** `computeDueAt` if it is still ahead, otherwise next week's. */
export function nextDueAt(settings: ScheduleSettings, now: Date): Date {
  const due = computeDueAt(settings, now);
  return due.getTime() > now.getTime() ? due : dueInWeekOf(settings, now, 7);
}

export function checkinWeekOf(dueAt: Date, timeZone: string): string {
  return mondayOf(dueAt, timeZone);
}
