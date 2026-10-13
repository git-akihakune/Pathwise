import type { CareerPathInput } from "@pathwise/core/services/paths";
import { Button } from "@/components/ui/button";

export interface PathsOutput {
  paths: CareerPathInput[];
  note?: string;
}

export function PathsCard({
  output,
  onSave,
  disabled,
}: {
  output: PathsOutput;
  onSave: (text: string) => void;
  disabled?: boolean;
}) {
  if (output.paths.length === 0) {
    return output.note ? <p className="text-sm text-muted-foreground">{output.note}</p> : null;
  }
  return (
    <div className="flex flex-col gap-3">
      {output.paths.map((p) => (
        <article key={p.title} className="flex flex-col gap-2 rounded-md border p-4">
          <h3 className="font-medium">{p.title}</h3>
          <p className="text-sm">{p.rationale}</p>
          <p className="text-sm text-muted-foreground">
            {p.feasibility.timeMonths.min}–{p.feasibility.timeMonths.max} months (estimate)
          </p>
          {p.skillGaps.length > 0 && (
            <ul className="list-disc pl-5 text-sm">
              {p.skillGaps.map((g) => (
                <li key={g.skill}>
                  {g.skill}
                  {g.note && <span className="text-muted-foreground"> — {g.note}</span>}
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => onSave(`Save the "${p.title}" path.`)}
            >
              Save this path
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}
