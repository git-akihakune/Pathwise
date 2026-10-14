"use client";

import { Eye, EyeOff } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SecretInput({
  secretLabel = "password",
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "type"> & { secretLabel?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative w-full">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-12", className)} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={props.disabled}
        aria-label={`${visible ? "Hide" : "Show"} ${secretLabel}`}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
        className="absolute right-0 top-0 text-muted-foreground"
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
