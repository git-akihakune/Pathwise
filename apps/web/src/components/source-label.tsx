import type { SourceType } from "@pathwise/core/services/profile";

export const SOURCE_LABELS: Record<SourceType, string> = {
  cv: "From your CV",
  linkedin: "From your LinkedIn profile",
  message: "From a conversation",
  checkin: "From a check-in",
  manual: "Added by you",
};

export function SourceLabel({ type }: { type: SourceType }) {
  return <span className="text-xs text-muted-foreground">{SOURCE_LABELS[type]}</span>;
}
