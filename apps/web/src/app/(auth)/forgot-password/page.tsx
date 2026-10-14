export const metadata = { title: "Forgot password" };

import Link from "next/link";
import { connection } from "next/server";
import { OriginBanner } from "@/components/origin-banner";
import { SimpleAuthForm } from "@/components/simple-auth-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServer } from "@/lib/server";
import { forgotPasswordAction } from "../actions";

export default async function ForgotPasswordPage() {
  await connection();
  const { config } = getServer();
  return (
    <div className="flex flex-col gap-4">
      <OriginBanner appUrl={config.appUrl} />
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Forgot password</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {config.smtp ? (
            <SimpleAuthForm
              action={forgotPasswordAction}
              field="email"
              label="Email"
              submitLabel="Send reset link"
              sentMessage="If an account exists for that email, we've sent a reset link."
            />
          ) : (
            <p className="text-sm">
              Password resets by email aren't available on this instance. Ask your admin to reset
              your password.
            </p>
          )}
          <Link href="/sign-in" className="text-sm underline">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
