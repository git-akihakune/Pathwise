import { countAdmins } from "@pathwise/core/auth";
import { getInstanceSettings } from "@pathwise/core/instance";
import Link from "next/link";
import { connection } from "next/server";
import { AuthForm } from "@/components/auth-form";
import { OriginBanner } from "@/components/origin-banner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServer } from "@/lib/server";
import { signUpAction } from "../actions";

export default async function SignUpPage() {
  await connection();
  const { db, config } = getServer();
  const first = (await countAdmins(db)) === 0;
  const { signupMode } = await getInstanceSettings(db);
  const showForm = first || signupMode === "open";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-4">
      <OriginBanner appUrl={config.appUrl} />
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>
              {first ? "Create the admin account" : showForm ? "Create your account" : "Sign up"}
            </h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {showForm ? (
            <>
              {first && (
                <p className="text-sm text-muted-foreground">
                  The first account administers this instance.
                </p>
              )}
              <AuthForm action={signUpAction} submitLabel="Create account" withName />
            </>
          ) : (
            <p className="text-sm">
              {signupMode === "closed"
                ? "Sign-up on this instance is closed."
                : "Sign-up on this instance is by invitation."}
            </p>
          )}
          <Link href="/sign-in" className="text-sm underline">
            Already have an account? Sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
