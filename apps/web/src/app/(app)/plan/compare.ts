import type { CareerPath } from "@pathwise/core/services/paths";

export interface ComparisonRow {
  label: string;
  cells: string[];
}

export const monthsLabel = ({ min, max }: { min: number; max: number }) =>
  min === max ? `${min} months` : `${min}–${max} months`;

const route = (p: CareerPath) =>
  p.route.map((s) => (s.isBridgeRole ? `${s.title} (bridge role)` : s.title)).join(" → ");

export function comparisonRows(paths: CareerPath[]): ComparisonRow[] {
  const row = (label: string, cell: (p: CareerPath) => string): ComparisonRow => ({
    label,
    cells: paths.map(cell),
  });
  return [
    row("Why it fits", (p) => p.rationale),
    row("Route", route),
    row("Skill gaps", (p) => p.skillGaps.map((g) => g.skill).join(", ")),
    row("Time", (p) => monthsLabel(p.feasibility.timeMonths)),
    row("Cost", (p) => p.feasibility.cost),
    row("Risks", (p) => p.feasibility.risks.join("; ")),
    row("What would have to be true", (p) => p.feasibility.mustBeTrue.join("; ")),
  ];
}
