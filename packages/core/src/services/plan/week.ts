import { TZDate } from "@date-fns/tz";
import { format, startOfISOWeek } from "date-fns";

/** The Monday (YYYY-MM-DD) of the ISO week containing `date`, as seen in `timeZone`. */
export function mondayOf(date: Date, timeZone: string): string {
  return format(startOfISOWeek(new TZDate(date, timeZone)), "yyyy-MM-dd");
}

/** The Monday of the week containing a calendar date (YYYY-MM-DD); no timezone involved. */
export function weekStartOf(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** A real calendar date in `YYYY-MM-DD` form (`Date.parse` alone rolls "2026-02-30" over to March). */
export function isDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
