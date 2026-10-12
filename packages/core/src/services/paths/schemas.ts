import { z } from "zod";

export type { SkillGap } from "../../taxonomy";

import type { SkillGap } from "../../taxonomy";

export interface RouteStep {
  title: string;
  kind: "role" | "learning" | "project" | "network" | "other";
  detail: string;
  isBridgeRole: boolean;
}

export interface Feasibility {
  timeMonths: { min: number; max: number };
  cost: string;
  risks: string[];
  mustBeTrue: string[];
}

export interface CareerPathInput {
  title: string;
  occupationCodes: string[];
  rationale: string;
  route: RouteStep[];
  skillGaps: SkillGap[];
  feasibility: Feasibility;
}

export interface CareerPath extends CareerPathInput {
  id: string;
  status: "explored" | "chosen" | "dismissed";
  version: number;
  createdAt: Date;
}

const text = (max: number) => z.string().trim().max(max);
const months = z.number().int().min(0).max(240);

const routeStepSchema = z.object({
  title: text(200).min(1),
  kind: z.enum(["role", "learning", "project", "network", "other"]),
  detail: text(1000),
  isBridgeRole: z.boolean(),
});

const skillGapSchema = z.object({
  skill: text(200).min(1),
  taxonomySkillId: z.string().max(200).nullable(),
  importance: z.number().min(0).max(1),
  note: text(500),
});

const feasibilitySchema = z.object({
  timeMonths: z
    .object({ min: months, max: months })
    .refine((t) => t.min <= t.max, { message: "Minimum time is longer than maximum." }),
  cost: text(500),
  risks: z.array(text(500).min(1)).max(10),
  mustBeTrue: z.array(text(500).min(1)).max(10),
});

export const careerPathInputSchema: z.ZodType<CareerPathInput> = z.object({
  title: text(200).min(1, "Enter a title."),
  occupationCodes: z.array(z.string().trim().min(1).max(50)).max(10),
  rationale: text(4000),
  route: z.array(routeStepSchema).max(12),
  skillGaps: z.array(skillGapSchema).max(30),
  feasibility: feasibilitySchema,
});
