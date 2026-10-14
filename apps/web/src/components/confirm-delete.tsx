"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { recoverFormAction } from "@/lib/form-recovery";

type ConfirmationState = { error?: string } | undefined;

export function ConfirmDelete({
  action,
  fields,
  label = "Delete",
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  label?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [state, submit, pending] = useActionState<ConfirmationState, FormData>(
    recoverFormAction<ConfirmationState>(async (_previous: ConfirmationState, data: FormData) => {
      await action(data);
      setAsking(false);
      return undefined;
    }),
    undefined,
  );
  if (!asking)
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  return (
    <Form
      noValidate
      result={state}
      trackChanges={false}
      action={submit}
      className="flex flex-wrap items-center gap-2"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <span className="text-sm">Permanently delete this item?</span>
      <Button type="submit" variant="destructive" size="sm" disabled={pending} aria-busy={pending}>
        Yes, delete
      </Button>
      <Button
        autoFocus
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => setAsking(false)}
      >
        Keep
      </Button>
    </Form>
  );
}
