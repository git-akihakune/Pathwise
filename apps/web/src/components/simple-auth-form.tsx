"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/(auth)/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [state, formAction, pending] = useActionState(action, undefined);
  if (state?.sent) return <Alert>{sentMessage}</Alert>;
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={field}>{label}</Label>
        <Input
          id={field}
          name={field}
          type={field}
          autoComplete={field === "email" ? "email" : "new-password"}
          required
        />
      </div>
      {token && <input type="hidden" name="token" value={token} />}
      {state?.error && <Alert variant="destructive">{state.error}</Alert>}
      <Button type="submit" disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
