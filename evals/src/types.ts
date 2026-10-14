export type CriterionId =
  | "no_fabrication"
  | "coach_style"
  | "proposals_well_formed"
  | "distress_handling"
  | "grounded_skill_gaps";
export interface Score {
  score: 1 | 2 | 3 | 4 | 5;
  reason: string;
}
export interface CaseResult {
  persona: string;
  scenario: string;
  transcript: { role: "user" | "assistant"; text: string; toolCalls?: string[] }[];
  proposals: { kind: string; payload: unknown }[];
  scores: Partial<Record<CriterionId, Score>>;
  error?: string;
}
export interface Summary {
  byCriterion: Partial<Record<CriterionId, { mean: number; n: number }>>;
  overall: number | null;
  lowScores: {
    persona: string;
    scenario: string;
    criterion: CriterionId;
    score: number;
    reason: string;
  }[];
  errors: number;
}
export interface RunResult {
  startedAt: string;
  models: { kind: string; main: string; fast: string; judge: string };
  cases: CaseResult[];
  summary: Summary;
}
