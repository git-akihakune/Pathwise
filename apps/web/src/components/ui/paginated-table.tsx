"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";

/** Pages the complete result supplied by existing user-scoped services. */
export function PaginatedTable({
  label,
  header,
  rows,
  columns,
  empty = "No records yet.",
}: {
  label: string;
  header: ReactNode;
  rows: ReactNode[];
  columns: number;
  empty?: string;
}) {
  const [page, setPage] = useState(0);
  const size = 10;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages - 1);
  const start = current * size;
  return (
    <div className="min-w-0">
      <Table aria-label={label}>
        <TableHeader>{header}</TableHeader>
        <TableBody>
          {rows.length ? (
            rows.slice(start, start + size)
          ) : (
            <TableRow>
              <TableCell colSpan={columns} className="py-8 text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p role="status" className="text-xs text-muted-foreground">
          {rows.length
            ? `${start + 1}–${Math.min(start + size, rows.length)} of ${rows.length}`
            : "0 records"}
        </p>
        {pages > 1 && (
          <nav aria-label={`${label} pagination`} className="flex items-center gap-2">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Previous page"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span className="text-xs">
              Page {current + 1} of {pages}
            </span>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Next page"
              disabled={current === pages - 1}
              onClick={() => setPage(current + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        )}
      </div>
    </div>
  );
}
