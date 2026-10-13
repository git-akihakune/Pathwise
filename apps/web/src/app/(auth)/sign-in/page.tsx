import Link from "next/link";
import { connection } from "next/server";
import { AuthForm } from "@/components/auth-form";
import { OriginBanner } from "@/components/origin-banner";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNext } from "@/lib/safe-next";
import { getServer } from "@/lib/server";
import { signInAction } from "../actions";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  await connection();
  const { next, reset } = await searchParams;
  const returnTo = safeNext(next);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-4">
      <OriginBanner appUrl={getServer().config.appUrl} />
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Sign in</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {reset === "1" && <Alert>Password updated. Sign in with your new password.</Alert>}
          <AuthForm
            action={signInAction}
            submitLabel="Sign in"
            next={returnTo === "/" ? undefined : returnTo}
          />
          {getServer().config.smtp && (
            <Link href="/forgot-password" className="text-sm underline">
              Forgot password?
            </Link>
          )}
          <Link href="/sign-up" className="text-sm underline">
            Create an account
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
