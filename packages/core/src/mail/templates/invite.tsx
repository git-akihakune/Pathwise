import { CtaButton, Layout, P } from "./layout";

export function InviteEmail({ inviterName, url }: { inviterName: string; url: string }) {
  return (
    <Layout preview="You're invited to Pathwise" footer={false}>
      <P>
        {inviterName} invited you to Pathwise, a personal career coach. This link expires in 7 days
        and works once.
      </P>
      <CtaButton href={url}>Accept invitation</CtaButton>
    </Layout>
  );
}
