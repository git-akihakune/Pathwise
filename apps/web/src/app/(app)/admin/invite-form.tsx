"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createInviteAction } from "./actions";

export function InviteForm() {
  const [state, action, pending] = useActionState(createInviteAction, undefined);
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex items-end gap-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-email">Invite email</Label>
          <Input id="invite-email" name="email" type="email" required className="w-72" />
        </div>
        <Button type="submit" disabled={pending}>
          Create invite
        </Button>
      </form>
      {state?.error && <Alert variant="destructive">{state.error}</Alert>}
      {state?.link && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input readOnly value={state.link} data-testid="invite-link" aria-label="Invite link" />
            <Button
              type="button"
              variant="outline"
              onClick={() => navigator.clipboard.writeText(state.link ?? "")}
            >
              Copy
            </Button>
          </div>
          {state.emailed && <p className="text-sm">We also emailed this link to {state.email}.</p>}
          {state.emailFailed && (
            <Alert variant="destructive">
              The email didn't go through; share the link directly.
            </Alert>
          )}
          <p className="text-sm text-muted-foreground">
            Share this link directly. It expires in 7 days and can be used once.
          </p>
        </div>
      )}
    </div>
  );
}
