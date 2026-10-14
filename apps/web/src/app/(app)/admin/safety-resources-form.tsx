"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recoverFormAction } from "@/lib/form-recovery";
import { saveSafetyResourcesAction } from "./actions";

type Row = { key: number; name: string; url: string };

export function SafetyResourcesForm({ resources }: { resources: { name: string; url: string }[] }) {
  const nextKey = useRef(resources.length);
  const [rows, setRows] = useState<Row[]>(resources.map((r, key) => ({ key, ...r })));
  const [state, action, pending] = useActionState(
    recoverFormAction(saveSafetyResourcesAction),
    undefined,
  );
  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Form
      noValidate
      trackChanges={false}
      dirty={
        JSON.stringify(rows.map(({ name, url }) => ({ name, url }))) !== JSON.stringify(resources)
      }
      result={state}
      action={action}
      className="flex flex-col gap-4"
    >
      {rows.map((row, i) => (
        <div key={row.key} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`safety-name-${row.key}`}>Resource name {i + 1}</Label>
            <Input
              id={`safety-name-${row.key}`}
              name="name"
              value={row.name}
              onChange={(e) => update(row.key, { name: e.target.value })}
              maxLength={80}
              required
              className="w-56"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`safety-url-${row.key}`}>Resource URL {i + 1}</Label>
            <Input
              id={`safety-url-${row.key}`}
              name="url"
              type="url"
              value={row.url}
              onChange={(e) => update(row.key, { url: e.target.value })}
              required
              className="w-80"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
          >
            Remove
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={rows.length >= 10}
          onClick={() => setRows((rs) => [...rs, { key: nextKey.current++, name: "", url: "" }])}
        >
          Add resource
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          Save safety resources
        </Button>
        {state?.saved && (
          <span role="status" className="text-sm text-muted-foreground">
            Saved.
          </span>
        )}
      </div>
    </Form>
  );
}
