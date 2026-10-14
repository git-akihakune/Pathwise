"use client";

import { useTransition } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setSignupModeAction } from "./actions";

export function SignupModeSelect({ value }: { value: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Label id="signup-mode-label">Who can sign up</Label>
      <Select
        value={value}
        disabled={pending}
        aria-busy={pending}
        onValueChange={(m) => start(() => setSignupModeAction(m))}
      >
        <SelectTrigger aria-labelledby="signup-mode-label" className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="invite_only">Invite only</SelectItem>
          <SelectItem value="closed">Closed</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
