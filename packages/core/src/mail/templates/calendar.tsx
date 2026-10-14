import { Layout, P } from "./layout";

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

export function CalendarEmail({
  name,
  method,
  day,
  time,
  timezone,
}: {
  name: string;
  method: "REQUEST" | "CANCEL";
  day: number;
  time: string;
  timezone: string;
}) {
  return (
    <Layout preview="Your weekly Pathwise check-in">
      <P>Hi {name},</P>
      {method === "REQUEST" ? (
        <P>
          {`Your check-ins are set for ${DAYS[day]} at ${time} (${timezone}). Add the attached event to your calendar.`}
        </P>
      ) : (
        <P>Weekly check-in emails are off, so we've removed the calendar event.</P>
      )}
    </Layout>
  );
}
