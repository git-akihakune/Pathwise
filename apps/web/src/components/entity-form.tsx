"use client";

import { createContext, type ReactNode, useActionState, useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/entity-action";
import { recoverFormAction } from "@/lib/form-recovery";

const OpenFormContext = createContext<{ open: string | null; setOpen: (k: string | null) => void }>(
  { open: null, setOpen: () => {} },
);

/** Holds which form is open, so opening one closes any other on the page. */
export function OpenFormProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  return <OpenFormContext.Provider value={{ open, setOpen }}>{children}</OpenFormContext.Provider>;
}

export function useOpenForm(key: string) {
  const { open, setOpen } = useContext(OpenFormContext);
  return { isOpen: open === key, show: () => setOpen(key), close: () => setOpen(null) };
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="flex-col items-start gap-1">
      {label}
      {children}
    </Label>
  );
}

/** A save form: hidden id/version when editing, an error alert, and Save/Cancel. Closes on success. */
export function EntityForm({
  action,
  entity,
  onDone,
  submitLabel = "Save",
  cancel,
  children,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  entity?: { id: string; version: number };
  onDone?: () => void;
  /** Replaces the Cancel button, e.g. with a link when the form is a page. */
  cancel?: ReactNode;
  submitLabel?: string;
  children: ReactNode;
}) {
  const [state, submit, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const result = await recoverFormAction(action)(prev, fd);
    if (!result?.error) onDone?.();
    return result;
  }, undefined);
  return (
    <Form
      result={state}
      noValidate
      error={state?.error}
      action={submit}
      className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-5"
    >
      {entity && (
        <>
          <input type="hidden" name="id" value={entity.id} />
          <input type="hidden" name="version" value={entity.version} />
        </>
      )}
      {children}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {submitLabel}
        </Button>
        {cancel ?? (
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </Form>
  );
}
