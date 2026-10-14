"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/(auth)/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SecretInput } from "@/components/ui/secret-input";
import { recoverFormAction } from "@/lib/form-recovery";

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  field: "email" | "password";
  label: string;
  submitLabel: string;
  sentMessage?: string;
  token?: string;
};

/** One-field auth form (forgot / reset password). */
export function SimpleAuthForm({ action, field, label, submitLabel, sentMessage, token }: Props) {
  const [state, formAction, pending] = useActionState(recoverFormAction(action), undefined);
  if (state?.sent) return <Alert>{sentMessage}</Alert>;
  return (
    <Form
      noValidate
      result={state}
      error={state?.error}
      action={formAction}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={field}>{label}</Label>
        {field === "password" ? (
          <SecretInput id={field} name={field} autoComplete="new-password" required />
        ) : (
          <Input id={field} name={field} type="email" autoComplete="email" required />
        )}
      </div>
      {token && <input type="hidden" name="token" value={token} />}
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {submitLabel}
      </Button>
    </Form>
  );
}
