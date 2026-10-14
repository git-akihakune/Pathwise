import type { TodayView } from "@pathwise/core/services/today";
import { CalendarDays } from "lucide-react";
import Link from "next/link";

export function TodayCheckin({
  checkin,
  timeZone,
}: {
  checkin: TodayView["checkin"];
  timeZone: string;
}) {
  const parts = checkin.nextDueAt
    ? new Intl.DateTimeFormat("en", {
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone,
      }).formatToParts(checkin.nextDueAt)
    : [];
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const time = `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
  return (
    <section aria-labelledby="today-checkin" className="workspace-section flex flex-col gap-4">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-primary">
        <CalendarDays className="size-5" aria-hidden="true" />
      </span>
      <h2 id="today-checkin" className="font-heading text-lg font-semibold">
        Weekly check-in
      </h2>
      {checkin.state === "open" && (
        <>
          <p>
            {checkin.nudged
              ? "Your check-in is still open. It only takes a few minutes."
              : "Your weekly check-in is ready."}
          </p>
          <Link
            href="/checkin"
            className="w-fit text-sm font-semibold text-primary underline underline-offset-4"
          >
            Start check-in
          </Link>
        </>
      )}
      {checkin.state === "completed" && <p>Check-in done for this week. Nice work.</p>}
      {checkin.state === "missed" && (
        <p>
          Last week's check-in slipped by. No problem, the next one is {weekday} {time}.
        </p>
      )}
      {checkin.state === "upcoming" && (
        <>
          <p>
            Next check-in: {weekday} at {time}.
          </p>
          <Link
            href="/settings"
            className="w-fit text-sm font-semibold text-primary underline underline-offset-4"
          >
            Change schedule
          </Link>
        </>
      )}
      {checkin.state === "off" && (
        <>
          <p>Weekly check-ins are off.</p>
          <Link
            href="/settings"
            className="w-fit text-sm font-semibold text-primary underline underline-offset-4"
          >
            Turn on
          </Link>
        </>
      )}
    </section>
  );
}
