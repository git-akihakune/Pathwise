"use client";

import { useActionState, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recoverFormAction } from "@/lib/form-recovery";
import { deleteAccountAction } from "./actions";

export function DeleteAccountDialog({ email }: { email: string }) {
  const [confirmEmail, setConfirmEmail] = useState("");
  const [state, action, pending] = useActionState(
    recoverFormAction(deleteAccountAction),
    undefined,
  );
  const matches = confirmEmail.trim().toLowerCase() === email.trim().toLowerCase();

  return (
    <Dialog>
      <DialogTrigger
        className={buttonVariants({ variant: "destructive", className: "self-start" })}
      >
        Delete account
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This permanently deletes your profile, stories, plan, conversations, and uploaded files.
            It cannot be undone. Download your data first if you want a copy.
          </DialogDescription>
        </DialogHeader>
        <Form noValidate result={state} action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-email">Type your email to confirm</Label>
            <Input
              id="confirm-email"
              name="confirmEmail"
              autoComplete="email"
              value={confirmEmail}
              onChange={(event) => setConfirmEmail(event.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending} aria-busy={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={!matches || pending}>
              {pending ? "Deleting…" : "Delete my account"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
