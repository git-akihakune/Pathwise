"use client";

import { createContext, type ReactNode, useActionState, useContext, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FormState } from "./actions";

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
  children,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  entity?: { id: string; version: number };
  onDone: () => void;
  children: ReactNode;
}) {
  const [state, submit, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const result = await action(prev, fd);
    if (!result?.error) onDone();
    return result;
  }, undefined);
  return (
    <form action={submit} className="flex flex-col gap-3 rounded-md border p-3">
      {entity && (
        <>
          <input type="hidden" name="id" value={entity.id} />
          <input type="hidden" name="version" value={entity.version} />
        </>
      )}
      {children}
      {state?.error && <Alert variant="destructive">{state.error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
