import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { eq, sql } from "drizzle-orm";
import type { AppConfig } from "../config";
import { type DbOrTx, schema } from "../db";
import { NotFoundError } from "../errors";
import { nextDueAt } from "../services/checkins/schedule";
import { getUserSettings, type UserSettings } from "../services/settings";
import { bareEmail, buildCheckinIcs } from "./ics";
import type { Mailer } from "./mailer";
import { renderCalendarEmail } from "./render";

type CalendarState = Pick<
  UserSettings,
  "checkinEnabled" | "emailEnabled" | "checkinDay" | "checkinTime" | "timezone"
>;

const live = (s: CalendarState) => s.checkinEnabled && s.emailEnabled;

/** Which calendar message (if any) a settings change calls for. `sequence` = invites sent so far. */
export function calendarAction(
  before: CalendarState,
  after: CalendarState,
  sequence: number,
  opts: { explicitSave: boolean },
): "request" | "cancel" | null {
  if (!live(after)) return sequence > 0 && live(before) ? "cancel" : null;
  if (!live(before)) return "request";
  const changed =
    before.checkinDay !== after.checkinDay ||
    before.checkinTime !== after.checkinTime ||
    before.timezone !== after.timezone;
  if (changed && (sequence > 0 || opts.explicitSave)) return "request";
  return opts.explicitSave && sequence === 0 ? "request" : null;
}

/** Emails the user a weekly check-in calendar event (REQUEST) or its cancellation (CANCEL). */
export async function sendCheckinCalendar(
  deps: { db: DbOrTx; config: AppConfig; mailer: Mailer },
  userId: string,
  method: "REQUEST" | "CANCEL",
  now: Date = new Date(),
): Promise<void> {
  const { db, config, mailer } = deps;
  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
  if (!u) throw new NotFoundError("User not found.");
  await getUserSettings(db, userId);
  const [row] = await db
    .update(schema.userSettings)
    .set({ checkinIcsSequence: sql`${schema.userSettings.checkinIcsSequence} + 1` })
    .where(eq(schema.userSettings.userId, userId))
    .returning();
  if (!row) throw new Error("user_settings row missing after update");
  const settings = await getUserSettings(db, userId);
  const timezone = settings.timezone ?? "UTC";
  const due = nextDueAt(settings, now);
  const ics = buildCheckinIcs({
    uid: `checkin-${userId}@${new URL(config.appUrl).hostname}`,
    method,
    sequence: row.checkinIcsSequence - 1,
    timezone,
    day: settings.checkinDay,
    time: settings.checkinTime,
    firstDate: format(new TZDate(due, timezone), "yyyy-MM-dd"),
    organizer: bareEmail(config.smtp?.from ?? "noreply@localhost"),
    attendee: { email: u.email, name: u.name },
    url: `${config.appUrl.replace(/\/$/, "")}/checkin`,
    now,
  });
  const rendered = await renderCalendarEmail({
    name: u.name,
    method,
    day: settings.checkinDay,
    time: settings.checkinTime,
    timezone,
  });
  await mailer.send({ to: u.email, ...rendered, ics: { method, content: ics } });
}
