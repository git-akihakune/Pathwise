import { type MockCall, type MockReply, registerMockFixture } from "../registry";

// Mock-mode replies for the coach runtime (LLM_MODE=mock, E2E). Texts stay at least two words so
// they stream in more than one chunk.

const DEFAULT_TEXT = "Mock coach reply. What would you like to work on?";
const TOOL_TEXT = "Here's what I found. Anything I suggest waits for your approval.";

/** classify wraps the latest message in a data block after the recent history; read only it. */
function latestText(call: MockCall): string {
  const m = /<data source="latest">\n([\s\S]*)\n<\/data>\s*$/.exec(call.lastUserText);
  return m?.[1] ?? call.lastUserText;
}

export const classifyFixture = (call: MockCall): MockReply => {
  const text = latestText(call);
  const distress = /can'?t go on|end my life|kill myself/i.test(text)
    ? "acute"
    : /overwhelmed|exhausted|burn(ed|t) out/i.test(text)
      ? "elevated"
      : "none";
  const skills = [
    ...(/path|career|direction|nurse|occupation/i.test(text) ? ["direction"] : []),
    ...(/plan|this week/i.test(text) ? ["planning"] : []),
  ];
  return { json: { skills, distress } };
};

const STORY = {
  title: "Cut the monthly reporting time in half",
  situation: "Monthly reports took the team three days to assemble by hand.",
  task: "Make the reports faster without losing accuracy.",
  action: "I automated the data pulls and built a shared template.",
  result: "Reports now take a day and a half, with fewer errors.",
  metrics: "50% less time",
  skills: ["Automation", "Reporting"],
};

const PLAN = {
  northStar: "Move into a new role",
  milestones: [{ title: "Pick a target role" }],
  actions: [
    { title: "List three roles that interest you" },
    { title: "Talk to one person working in a target role" },
  ],
};

function chatToolCall(text: string): { toolName: string; input: unknown } | null {
  const remember = /remember that (.+?)\.?$/i.exec(text);
  if (remember?.[1]) {
    const content = remember[1].charAt(0).toUpperCase() + remember[1].slice(1);
    return {
      toolName: "proposeMemory",
      input: { category: "preference", content, sensitive: false },
    };
  }
  if (/save a story/i.test(text)) return { toolName: "proposeStory", input: STORY };
  // R6: a fresh profile has nothing to search by, so the mock gives the tool a focus.
  if (/suggest paths/i.test(text))
    return { toolName: "generateCareerPaths", input: { focus: "nurse" } };
  if (/make a plan/i.test(text)) return { toolName: "proposePlan", input: PLAN };
  if (/look up registered nurse/i.test(text)) {
    return { toolName: "getOccupation", input: { idOrCode: "29-1141.00" } };
  }
  return null;
}

export const chatFixture = (call: MockCall): MockReply => {
  if (call.toolNames.length === 0) return { text: DEFAULT_TEXT };
  const toolCall = chatToolCall(call.lastUserText.trim());
  if (!toolCall || !call.toolNames.includes(toolCall.toolName)) return { text: DEFAULT_TEXT };
  return { toolCalls: [toolCall], text: TOOL_TEXT };
};

/** Two paths from the first two candidate occupations in the prompt, with their listed gaps. */
export const pathsFixture = (call: MockCall): MockReply => {
  const prompt = call.lastUserText;
  const codes = [...new Set(prompt.match(/\b\d{2}-\d{4}\.\d{2}\b/g) ?? [])].slice(0, 2);
  const paths = codes.map((code) => {
    const block = prompt.slice(prompt.indexOf(`code: ${code}`)).split("\n\n")[0] ?? "";
    const title = /\| (.+) \((?:onet|esco)\)/.exec(block)?.[1] ?? code;
    const gaps = (/^gaps: (.+)$/m.exec(block)?.[1] ?? "")
      .split(", ")
      .filter(Boolean)
      .slice(0, 2)
      .map((g) => g.replace(/ \([\d.]+\)$/, ""));
    return {
      title: `Become ${title}`,
      occupationCodes: [code],
      rationale: `A mock path toward ${title}.`,
      route: [
        {
          title: "Take an introductory course",
          kind: "learning",
          detail: "Learn the basics.",
          isBridgeRole: false,
        },
        { title, kind: "role", detail: "Apply for entry-level openings.", isBridgeRole: false },
      ],
      skillGaps: gaps.map((skill) => ({
        skill,
        taxonomySkillId: null,
        importance: 0.5,
        note: "Build this up.",
      })),
      feasibility: {
        timeMonths: { min: 12, max: 24 },
        cost: "Moderate (estimate)",
        risks: ["Training takes time."],
        mustBeTrue: ["You can study part-time."],
      },
    };
  });
  return { json: { paths } };
};

registerMockFixture("classify", classifyFixture);
registerMockFixture("chat", chatFixture);
registerMockFixture("curate.extract", () => ({
  json: { memories: [], stories: [], actionUpdates: [] },
}));
registerMockFixture("curate.dedupe", () => ({ json: { decision: "new" } }));
registerMockFixture("session.summarize", () => ({
  text: "The user and coach talked about next steps.",
}));
registerMockFixture("snapshot", () => ({ text: "The user is exploring a career change." }));
registerMockFixture("paths.generate", pathsFixture);
