import { CtaButton, Layout, P } from "./layout";

export function encouragement(done: number, total: number): string {
  if (total === 0) return "A check-in is a good moment to plan the week ahead.";
  if (done === 0) return "No pressure. A short check-in is the easiest way to get going again.";
  if (done === total) return "You finished everything you planned. Great week.";
  return `You finished ${done} of ${total} actions this week. Small steps add up.`;
}

export function CheckinEmail({
  name,
  done,
  remaining,
  url,
}: {
  name: string;
  weekOf: string;
  done: string[];
  remaining: string[];
  url: string;
}) {
  return (
    <Layout preview="Your weekly check-in is ready">
      <P>Hi {name},</P>
      <P>Here's your week:</P>
      {done.length > 0 && (
        <>
          <P>
            <strong>Done</strong>
          </P>
          <ul>
            {done.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
      {remaining.length > 0 && (
        <>
          <P>
            <strong>Still open</strong>
          </P>
          <ul>
            {remaining.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
      <P>{encouragement(done.length, done.length + remaining.length)}</P>
      <CtaButton href={url}>Start check-in</CtaButton>
    </Layout>
  );
}
