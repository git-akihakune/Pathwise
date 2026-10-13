import { CtaButton, Layout, P } from "./layout";

export function PasswordResetEmail({ name, url }: { name: string; url: string }) {
  return (
    <Layout preview="Reset your Pathwise password" footer={false}>
      <P>Hi {name},</P>
      <P>
        Someone asked to reset the password for this account. If it was you, choose a new password.
        The link expires in 1 hour. If it wasn't you, ignore this email.
      </P>
      <CtaButton href={url}>Choose a new password</CtaButton>
    </Layout>
  );
}
