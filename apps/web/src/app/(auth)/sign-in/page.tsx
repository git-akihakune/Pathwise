import Link from "next/link";
import { connection } from "next/server";
import { AuthForm } from "@/components/auth-form";
import { OriginBanner } from "@/components/origin-banner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServer } from "@/lib/server";
import { signInAction } from "../actions";

export default async function SignInPage() {
  await connection();
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
          <AuthForm action={signInAction} submitLabel="Sign in" />
          <Link href="/sign-up" className="text-sm underline">
            Create an account
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
