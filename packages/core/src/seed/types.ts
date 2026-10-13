import type { MemoryCategory } from "../services/memory";
import type { CareerPathInput } from "../services/paths";
import type { SkillLevel } from "../services/profile";
import type { StoryInput } from "../services/stories";

export interface PersonaData {
  name: string;
  timezone: string;
  bluntness: 1 | 2 | 3 | 4 | 5;
  experiences: {
    title: string;
    organization: string;
    startDate: string;
    endDate: string | null;
    description?: string;
    highlights: string[];
  }[];
  education: {
    institution: string;
    qualification: string;
    field: string;
    startDate: string;
    endDate: string | null;
  }[];
  skills: { name: string; level: SkillLevel }[];
  memory: {
    category: MemoryCategory;
    content: string;
    sensitive: boolean;
    status: "active" | "pending";
  }[];
  stories: StoryInput[];
  paths: (CareerPathInput & { status: "explored" | "chosen" })[];
  plan?: {
    northStar: string;
    pathTitle: string;
    milestones: { title: string; description?: string; targetInWeeks: number }[];
    actions: {
      title: string;
      notes?: string;
      weekOffset: 0 | -1;
      milestoneIndex: number;
      status: "todo" | "done" | "skipped";
    }[];
  };
  sessions?: {
    topic: string;
    daysAgo: number;
    messages: { role: "user" | "assistant"; text: string }[];
  }[];
  pendingStoryProposals?: StoryInput[];
}
