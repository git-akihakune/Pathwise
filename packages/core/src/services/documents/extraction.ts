import { z } from "zod";
import { MEMORY_CATEGORIES, type MemoryCategory } from "../memory/service";
import { partialDate, type SkillLevel } from "../profile";

export interface ExtractedExperience {
  title: string;
  organization: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  highlights: string[];
}
export interface ExtractedEducation {
  institution: string;
  qualification: string | null;
  field: string | null;
  startDate: string | null;
  endDate: string | null;
}
export interface ExtractedSkill {
  name: string;
  level: SkillLevel | null;
  evidence: string | null;
}
export interface ExtractedMemory {
  category: MemoryCategory;
  content: string;
  sensitive: boolean;
}
export interface ExtractedStory {
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  metrics: string | null;
  skills: string[];
}
export interface DocumentExtraction {
  experiences: ExtractedExperience[];
  education: ExtractedEducation[];
  skills: ExtractedSkill[];
  memories: ExtractedMemory[];
  stories: ExtractedStory[];
  truncated: boolean;
}

export const MIN_TEXT_CHARS = 50;

const str = z.string().nullish();
/**
 * What the model returns. Deliberately lenient (free-form dates, no length or item caps, no enums):
 * `normalizeExtraction` clamps and filters afterwards, so a long CV never becomes a StructuredOutputError.
 */
export const documentExtractionSchema = z.object({
  experiences: z.array(
    z.object({
      title: z.string(),
      organization: str,
      startDate: str.describe("YYYY, YYYY-MM or YYYY-MM-DD; null if unknown or ongoing"),
      endDate: str.describe("YYYY, YYYY-MM or YYYY-MM-DD; null if unknown or ongoing"),
      description: str,
      highlights: z.array(z.string()).nullish(),
    }),
  ),
  education: z.array(
    z.object({
      institution: z.string(),
      qualification: str,
      field: str,
      startDate: str,
      endDate: str,
    }),
  ),
  skills: z.array(
    z.object({
      name: z.string(),
      level: str.describe("basic, working, strong or expert; null if unclear"),
      evidence: str,
    }),
  ),
  memories: z.array(
    z.object({
      category: z.string().describe(MEMORY_CATEGORIES.join(", ")),
      content: z.string(),
      sensitive: z.boolean().nullish(),
    }),
  ),
  stories: z.array(
    z.object({
      title: z.string(),
      situation: z.string(),
      task: z.string(),
      action: z.string(),
      result: z.string(),
      metrics: str,
      skills: z.array(z.string()).nullish(),
    }),
  ),
});
type RawExtraction = z.infer<typeof documentExtractionSchema>;

/** Kept when it is a valid Plan 3 partial date (YYYY, YYYY-MM, YYYY-MM-DD), else null. */
export function normalizeDate(s: string | null | undefined): string | null {
  const v = s?.trim();
  return v && partialDate.safeParse(v).success ? v : null;
}

/** 4 characters per token, leaving 1,500 tokens for instructions and the reply. */
export function extractionBudgetChars(contextWindow: number): number {
  return 4 * Math.max(2000, Math.min(Math.floor(0.6 * contextWindow), 32_000) - 1500);
}

const clamp = (s: string | null | undefined, max: number): string | null => {
  const v = s?.trim().slice(0, max);
  return v || null;
};
const req = (s: string, max: number) => s.trim().slice(0, max);
const LEVELS: readonly string[] = ["basic", "working", "strong", "expert"];

export function normalizeExtraction(raw: RawExtraction, truncated: boolean): DocumentExtraction {
  const range = (start: string | null | undefined, end: string | null | undefined) => {
    const startDate = normalizeDate(start);
    let endDate = normalizeDate(end);
    if (startDate && endDate && endDate.padEnd(10, "9") < startDate) endDate = null;
    return { startDate, endDate };
  };
  return {
    experiences: raw.experiences
      .slice(0, 30)
      .map((e) => ({
        title: req(e.title, 200),
        organization: clamp(e.organization, 200),
        ...range(e.startDate, e.endDate),
        description: clamp(e.description, 4000),
        highlights: (e.highlights ?? [])
          .map((h) => h.trim().slice(0, 4000))
          .filter(Boolean)
          .slice(0, 20),
      }))
      .filter((e) => e.title),
    education: raw.education
      .slice(0, 15)
      .map((e) => ({
        institution: req(e.institution, 200),
        qualification: clamp(e.qualification, 200),
        field: clamp(e.field, 200),
        ...range(e.startDate, e.endDate),
      }))
      .filter((e) => e.institution),
    skills: raw.skills
      .slice(0, 60)
      .map((s) => ({
        name: req(s.name, 200),
        level: (s.level && LEVELS.includes(s.level) ? s.level : null) as SkillLevel | null,
        evidence: clamp(s.evidence, 4000),
      }))
      .filter((s) => s.name),
    memories: raw.memories
      .slice(0, 10)
      .filter((m) => (MEMORY_CATEGORIES as readonly string[]).includes(m.category))
      .map((m) => ({
        category: m.category as MemoryCategory,
        content: req(m.content, 1000),
        sensitive: m.sensitive === true,
      }))
      .filter((m) => m.content),
    stories: raw.stories
      .slice(0, 5)
      .map((s) => ({
        title: req(s.title, 200),
        situation: req(s.situation, 4000),
        task: req(s.task, 4000),
        action: req(s.action, 4000),
        result: req(s.result, 4000),
        metrics: clamp(s.metrics, 500),
        skills: [
          ...new Map(
            (s.skills ?? [])
              .map((k) => k.trim().slice(0, 100))
              .filter(Boolean)
              .map((k) => [k.toLowerCase(), k]),
          ).values(),
        ].slice(0, 20),
      }))
      .filter((s) => s.title),
    truncated,
  };
}
