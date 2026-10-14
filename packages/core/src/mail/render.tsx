import { render } from "@react-email/components";
import type { ReactElement } from "react";
import { CalendarEmail } from "./templates/calendar";
import { CheckinEmail, encouragement } from "./templates/checkin";
import { InviteEmail } from "./templates/invite";
import { NudgeEmail } from "./templates/nudge";
import { PasswordResetEmail } from "./templates/password-reset";
import { VerifyEmail } from "./templates/verify-email";

export type Rendered = { subject: string; html: string; text: string };

export { encouragement };

async function both(subject: string, el: ReactElement): Promise<Rendered> {
  return { subject, html: await render(el), text: await render(el, { plainText: true }) };
}

export function renderCheckinEmail(i: {
  name: string;
  weekOf: string;
  done: string[];
  remaining: string[];
  url: string;
}): Promise<Rendered> {
  return both("Your weekly check-in is ready", <CheckinEmail {...i} />);
}

export function renderNudgeEmail(i: { name: string; url: string }): Promise<Rendered> {
  return both("Your check-in is still open", <NudgeEmail {...i} />);
}

export function renderInviteEmail(i: { inviterName: string; url: string }): Promise<Rendered> {
  return both("You're invited to Pathwise", <InviteEmail {...i} />);
}

export function renderPasswordResetEmail(i: { name: string; url: string }): Promise<Rendered> {
  return both("Reset your Pathwise password", <PasswordResetEmail {...i} />);
}

export function renderVerificationEmail(i: { name: string; url: string }): Promise<Rendered> {
  return both("Verify your email for Pathwise", <VerifyEmail {...i} />);
}

export function renderCalendarEmail(i: {
  name: string;
  method: "REQUEST" | "CANCEL";
  day: number;
  time: string;
  timezone: string;
}): Promise<Rendered> {
  return both(
    i.method === "REQUEST" ? "Your weekly Pathwise check-in" : "Weekly Pathwise check-in cancelled",
    <CalendarEmail {...i} />,
  );
}
