import type { MemoryCategory, MemoryItem } from "../services/memory";
import type { Profile } from "../services/profile";

const MEMORY_LINES: [MemoryCategory, string][] = [
  ["value", "Values"],
  ["constraint", "Constraints"],
  ["aspiration", "Aspirations"],
  ["energizer", "Energizers"],
  ["drain", "Drains"],
  ["preference", "Preferences"],
];

const month = (d: string) => d.slice(0, 7);

/** Deterministic profile text used until an LLM snapshot exists. */
export function renderProfileFallback(profile: Profile, memories: MemoryItem[]): string {
  const lines: string[] = [];
  if (profile.experiences.length > 0) {
    const items = profile.experiences.map((e) => {
      const range = e.startDate
        ? ` (${month(e.startDate)} – ${e.endDate ? month(e.endDate) : "present"})`
        : "";
      return `${e.title}${e.organization ? ` at ${e.organization}` : ""}${range}`;
    });
    lines.push(`Experience: ${items.join("; ")}`);
  }
  if (profile.education.length > 0) {
    const items = profile.education.map((e) => {
      const what = [e.qualification, e.field].filter(Boolean).join(" in ");
      return what ? `${what}, ${e.institution}` : e.institution;
    });
    lines.push(`Education: ${items.join("; ")}`);
  }
  if (profile.skills.length > 0) {
    lines.push(
      `Skills: ${profile.skills.map((s) => (s.level ? `${s.name} (${s.level})` : s.name)).join(", ")}`,
    );
  }
  for (const [category, label] of MEMORY_LINES) {
    const items = memories.filter((m) => m.status === "active" && m.category === category);
    if (items.length > 0) lines.push(`${label}: ${items.map((m) => m.content).join("; ")}`);
  }
  return lines.length > 0 ? lines.join("\n") : "The user hasn't shared their background yet.";
}
