"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

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
  if (!asking) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <form action={action} className="flex items-center gap-2">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <span className="text-sm">Delete this?</span>
      <Button type="submit" variant="destructive" size="sm">
        Yes, delete
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setAsking(false)}>
        Keep
      </Button>
    </form>
  );
}
