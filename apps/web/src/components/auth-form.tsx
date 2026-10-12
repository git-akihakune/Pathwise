"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/(auth)/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  withName?: boolean;
  inviteToken?: string;
  /** Pre-filled, read-only email (invitation sign-up). */
  fixedEmail?: string;
};

export function AuthForm({ action, submitLabel, withName, inviteToken, fixedEmail }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {withName && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            defaultValue={state?.values?.name}
            required
          />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={fixedEmail ?? state?.values?.email}
          readOnly={fixedEmail !== undefined}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={withName ? "new-password" : "current-password"}
          required
        />
      </div>
      {inviteToken && <input type="hidden" name="inviteToken" value={inviteToken} />}
      {state?.error && <Alert variant="destructive">{state.error}</Alert>}
      <Button type="submit" disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
