import Link from "next/link";
import { connection } from "next/server";
import { OriginBanner } from "@/components/origin-banner";
import { SimpleAuthForm } from "@/components/simple-auth-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServer } from "@/lib/server";
import { resetPasswordAction } from "../actions";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  await connection();
  const { token, error } = await searchParams;
  const invalid = Boolean(error) || !token;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-4">
      <OriginBanner appUrl={getServer().config.appUrl} />
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Reset password</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {invalid ? (
            <Alert variant="destructive">This reset link has expired or was already used.</Alert>
          ) : (
            <SimpleAuthForm
              action={resetPasswordAction}
              field="password"
              label="New password"
              submitLabel="Set new password"
              token={token}
            />
          )}
          <Link href="/sign-in" className="text-sm underline">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
