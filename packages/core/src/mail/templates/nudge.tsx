import { CtaButton, Layout, P } from "./layout";

export function NudgeEmail({ name, url }: { name: string; url: string }) {
  return (
    <Layout preview="Your check-in is still open">
      <P>Hi {name}, your weekly check-in is still open. It only takes a few minutes.</P>
      <CtaButton href={url}>Start check-in</CtaButton>
    </Layout>
  );
}
