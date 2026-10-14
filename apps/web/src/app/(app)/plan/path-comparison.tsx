"use client";

import type { CareerPath } from "@pathwise/core/services/paths";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { setPathStatusAction } from "./actions";
import { comparisonRows, monthsLabel } from "./compare";

const STATUS_LABEL = { explored: "Explored", chosen: "Chosen", dismissed: "Dismissed" } as const;

export function PathComparison({ paths }: { paths: CareerPath[] }) {
  const [ticked, setTicked] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const setStatus = (id: string, status: "chosen" | "dismissed") =>
    startTransition(async () => {
      const result = await setPathStatusAction(id, status);
      setError(result?.error);
    });
  const active = paths.filter((p) => p.status !== "dismissed");
  const dismissed = paths.filter((p) => p.status === "dismissed");
  const compared = active.filter((p) => ticked.includes(p.id));
  return (
    <section aria-labelledby="paths-heading" className="workspace-section flex flex-col gap-4">
      <h2 id="paths-heading" className="font-heading text-lg font-semibold">
        Career paths
      </h2>
      {error && <Alert variant="destructive">{error}</Alert>}
      {paths.length === 0 && (
        <p className="text-muted-foreground">
          No career paths yet. Ask your coach to suggest some.
        </p>
      )}
      {active.map((p) => (
        <article key={p.id} className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-5">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{p.title}</h3>
            <Badge variant="secondary">{STATUS_LABEL[p.status]}</Badge>
          </div>
          <p className="text-sm">{p.rationale}</p>
          <p className="text-sm text-muted-foreground">{monthsLabel(p.feasibility.timeMonths)}</p>
          <div className="flex flex-wrap items-center gap-4">
            <Label className="gap-2">
              <Checkbox
                aria-label={`Compare ${p.title}`}
                checked={ticked.includes(p.id)}
                onCheckedChange={(on) =>
                  setTicked(on === true ? [...ticked, p.id] : ticked.filter((id) => id !== p.id))
                }
              />
              Compare
            </Label>
            {p.status === "explored" && (
              <Button
                type="button"
                size="sm"
                disabled={pending}
                aria-busy={pending}
                onClick={() => setStatus(p.id, "chosen")}
              >
                Choose
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              aria-busy={pending}
              onClick={() => setStatus(p.id, "dismissed")}
            >
              Dismiss
            </Button>
          </div>
        </article>
      ))}
      {compared.length >= 2 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">Compare paths</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                {compared.map((p) => (
                  <TableHead key={p.id}>{p.title}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparisonRows(compared).map((row) => (
                <TableRow key={row.label}>
                  <TableHead scope="row">{row.label}</TableHead>
                  {row.cells.map((cell, i) => (
                    <TableCell key={compared[i]?.id} className="whitespace-normal align-top">
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {dismissed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">Dismissed paths</summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {dismissed.map((p) => (
              <li key={p.id}>{p.title}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
