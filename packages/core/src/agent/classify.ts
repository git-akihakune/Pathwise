import type { UIMessage } from "ai";
import { z } from "zod";
import { isAuthError } from "../llm/auth";
import { generateStructured } from "../llm/generate";
import type { Llm, LlmDeps } from "../llm/types";
import { createLogger } from "../logger";
import { wrapData } from "./context";
import { type Distress, keywordDistress, maxDistress } from "./distress";
import { listSkills, type SkillId } from "./registry";
import { WORKFLOW_ONLY } from "./select";

const log = createLogger("agent");

const classifySchema = z.object({
  skills: z.array(z.string()),
  distress: z.enum(["none", "elevated", "acute"]),
});

function line(m: UIMessage): string {
  const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  return `${m.role === "user" ? "User" : "Coach"}: ${text}`;
}

export async function classify(
  deps: LlmDeps,
  llm: Llm,
  input: { text: string; history: UIMessage[] },
): Promise<{ skills: SkillId[]; distress: Distress }> {
  try {
    const available = listSkills().filter((s) => s.id !== "core" && !WORKFLOW_ONLY.includes(s.id));
    const instructions = [
      "Classify the user's latest message for a career coach. skills: the extra skills the coach needs for the reply (zero or more), from this list:",
      ...available.map((s) => `- ${s.id}: ${s.description}`),
      'distress: "acute" if the user mentions suicide, self-harm, or being in immediate danger; "elevated" for strong distress such as hopelessness, panic, or burnout; otherwise "none".',
    ].join("\n");
    const prompt = `${wrapData("conversation", input.history.slice(-4).map(line).join("\n"))}\n${wrapData("latest", input.text)}`;
    const out = await generateStructured(deps, llm, {
      role: "fast",
      purpose: "classify",
      schema: classifySchema,
      instructions,
      prompt,
    });
    const known = new Set<string>(available.map((s) => s.id));
    return {
      skills: out.skills.filter((s): s is SkillId => known.has(s)).slice(0, 4),
      distress: maxDistress(out.distress, keywordDistress(input.text)),
    };
  } catch (e) {
    if (isAuthError(e)) throw e;
    log.warn({ err: e instanceof Error ? e.name : typeof e }, "classify failed, using fallback");
    return { skills: [], distress: keywordDistress(input.text) };
  }
}
