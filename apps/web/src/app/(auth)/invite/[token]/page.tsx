import { describeInvite, type InviteStatus } from "@pathwise/core/invites";
import Link from "next/link";
import { connection } from "next/server";
import { AuthForm } from "@/components/auth-form";
import { OriginBanner } from "@/components/origin-banner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServer } from "@/lib/server";
import { signUpAction } from "../../actions";

const MESSAGES: Record<Exclude<InviteStatus, "usable"> | "unknown", string> = {
  used: "This invitation has already been used.",
  expired: "This invitation has expired. Ask your admin for a new one.",
  revoked: "This invitation was withdrawn. Ask your admin for a new one.",
  unknown: "This invitation link isn't valid. Check that you copied the whole link.",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const { db, config } = getServer();
  const invite = await describeInvite(db, token);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-4">
      <OriginBanner appUrl={config.appUrl} />
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{invite.status === "usable" ? "Accept your invitation" : "Invitation"}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {invite.status === "usable" ? (
            <AuthForm
              action={signUpAction}
              submitLabel="Create account"
              withName
              inviteToken={token}
              fixedEmail={invite.email}
            />
          ) : (
            <>
              <p className="text-sm">{MESSAGES[invite.status]}</p>
              <Link href="/sign-in" className="text-sm underline">
                Sign in
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
