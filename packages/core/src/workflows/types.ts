import { z } from "zod";
import type { SkillId } from "../agent/registry";
import type { TurnDeps } from "../agent/turn";
import type { DbOrTx } from "../db";

export type WorkflowType = "onboarding" | "checkin";
export type StepKind = "conversational" | "compute" | "ui";
export type RunStatus = "active" | "needs_attention" | "completed" | "abandoned";

export const completionCheckSchema = z.object({ done: z.boolean(), reason: z.string().max(300) });
export type CompletionCheck = z.infer<typeof completionCheckSchema>;

export interface StepRecord {
  /** Unset while a conversational step is open (it only holds the opener and last check). */
  status?: "done" | "skipped";
  at: string;
  check?: CompletionCheck;
  openerMessageId?: string;
}

export type RunState = Record<string, unknown> & {
  steps?: Record<string, StepRecord>;
  attention?: { stepId: string; message: string };
};

export interface WorkflowRun {
  id: string;
  type: WorkflowType;
  stepId: string;
  state: RunState;
  status: RunStatus;
  createdAt: Date;
  completedAt: Date | null;
}

export type WorkflowDeps = TurnDeps;

/** `db` is the transaction for a ui step's `apply` and for `onComplete`. */
export interface StepContext {
  deps: WorkflowDeps;
  db: DbOrTx;
  userId: string;
  run: WorkflowRun;
}

export interface StepResult {
  state?: Record<string, unknown>;
  wait?: boolean;
}

interface StepBase {
  id: string;
  skipWhen?(state: RunState): boolean;
}

export type Step =
  | (StepBase & {
      kind: "conversational";
      skills: SkillId[];
      goal: string | ((s: RunState) => string);
      opener: string | ((s: RunState) => string);
      completion?: typeof completionCheckSchema;
      /** Deterministic completion, checked alongside the LLM completion check (R12). */
      isComplete?(ctx: StepContext): boolean | Promise<boolean>;
    })
  | (StepBase & {
      kind: "compute";
      run(ctx: StepContext): Promise<StepResult>;
      manualHint: string;
    })
  | (StepBase & {
      kind: "ui";
      input: z.ZodType;
      apply?(ctx: StepContext, result: unknown): Promise<StepResult>;
    });

export interface WorkflowDefinition {
  type: WorkflowType;
  steps: Step[];
  onComplete?(ctx: StepContext): Promise<void>;
}

export const COMPUTE_ATTEMPTS = 3;
export const COMPUTE_LEASE_MS = 300_000;

export const ATTENTION_MESSAGES = {
  auth: "Your API key was rejected. Update it in Settings.",
  noProvider: "Connect an AI provider in Settings, then retry.",
  format: "The AI reply wasn't in the expected format.",
  provider: "The AI provider returned an error.",
  unknown: "Something went wrong.",
};
