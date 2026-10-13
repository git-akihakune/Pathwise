import { CtaButton, Layout, P } from "./layout";

export function VerifyEmail({ name, url }: { name: string; url: string }) {
  return (
    <Layout preview="Verify your email for Pathwise" footer={false}>
      <P>Hi {name},</P>
      <P>Confirm this is your email address.</P>
      <CtaButton href={url}>Verify email</CtaButton>
    </Layout>
  );
}
