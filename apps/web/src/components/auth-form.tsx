"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SecretInput } from "@/components/ui/secret-input";
import { recoverFormAction } from "@/lib/form-recovery";

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  withName?: boolean;
  inviteToken?: string;
  /** Pre-filled, read-only email (invitation sign-up). */
  fixedEmail?: string;
  /** Post-sign-in return path; the server re-validates it with safeNext. */
  next?: string;
};

export function AuthForm({ action, submitLabel, withName, inviteToken, fixedEmail, next }: Props) {
  const [state, formAction, pending] = useActionState(recoverFormAction(action), undefined);
  return (
    <Form
      noValidate
      result={state}
      error={state?.error}
      action={formAction}
      className="flex flex-col gap-4"
    >
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
        <SecretInput
          id="password"
          name="password"
          autoComplete={withName ? "new-password" : "current-password"}
          required
        />
      </div>
      {next && <input type="hidden" name="next" value={next} />}
      {inviteToken && <input type="hidden" name="inviteToken" value={inviteToken} />}
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {submitLabel}
      </Button>
    </Form>
  );
}
