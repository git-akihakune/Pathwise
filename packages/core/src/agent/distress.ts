import type { SafetyResource } from "../instance";

export type Distress = "none" | "elevated" | "acute";

const ACUTE = [
  "suicidal",
  "kill myself",
  "end my life",
  "take my own life",
  "hurt myself",
  "harm myself",
  "(?:don'?t|do not) want to live",
  "(?:don'?t|do not) want to be alive",
  "better off dead",
  "(?:can'?t|cannot|can not) go on",
];
const ELEVATED = [
  "hopeless",
  "overwhelmed",
  "burnt out",
  "burned out",
  "burnout",
  "panicking",
  "panic attack",
  "(?:can'?t|cannot|can not) cope",
  "falling apart",
  "breaking down",
];

const toRegex = (list: string[]) => new RegExp(`\\b(?:${list.join("|")})\\b`, "i");
const ACUTE_RE = toRegex(ACUTE);
const ELEVATED_RE = toRegex(ELEVATED);

/** Safety net for when the classifier fails or misses distress. Normalises curly apostrophes. */
export function keywordDistress(text: string): Distress {
  const t = text.replaceAll("’", "'");
  if (ACUTE_RE.test(t)) return "acute";
  if (ELEVATED_RE.test(t)) return "elevated";
  return "none";
}

const RANK: Record<Distress, number> = { none: 0, elevated: 1, acute: 2 };

export function maxDistress(a: Distress, b: Distress): Distress {
  return RANK[a] >= RANK[b] ? a : b;
}

export const SAFETY_RESPONSE = (resources: SafetyResource[]): string =>
  `I'm really sorry you're going through this. I'm an AI career coach, so I can't help with this the way a person can, and your safety matters more than anything we were working on.

If you might act on thoughts of harming yourself, or you're in immediate danger, please contact your local emergency number now.

You can reach someone to talk to here:
${resources.map((r) => `- [${r.name}](${r.url})`).join("\n")}

If you can, tell someone you trust how you're feeling. I'm here to talk about your career whenever you want to come back to it.`;
