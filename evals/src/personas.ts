import type { PersonaData } from "@pathwise/core/seed";

export interface EvalPersona {
  id: string;
  data: PersonaData;
  facts: string[];
  brief: string;
}

type Experience = PersonaData["experiences"][number];
const experience = (
  title: string,
  organization: string,
  startDate: string,
  endDate: string | null,
  highlights: string[],
): Experience => ({ title, organization, startDate, endDate, highlights });
const path = (
  title: string,
  status: "explored" | "chosen",
  occupationCodes: string[],
  rationale: string,
  gap: string,
): PersonaData["paths"][number] => ({
  title,
  status,
  occupationCodes,
  rationale,
  route: [
    {
      title: `Build evidence for ${title}`,
      kind: "project",
      detail: "Start with one small work sample.",
      isBridgeRole: false,
    },
    {
      title,
      kind: "role",
      detail: "Explore suitable vacancies after checking requirements.",
      isBridgeRole: false,
    },
  ],
  skillGaps: [
    {
      skill: gap,
      importance: 0.8,
      taxonomySkillId: null,
      note: "A learning need to validate against actual roles.",
    },
  ],
  feasibility: {
    timeMonths: { min: 6, max: 18 },
    cost: "Estimate: use free learning resources initially.",
    risks: ["Entry requirements vary by employer."],
    mustBeTrue: ["The route must fit the stated time and income constraints."],
  },
});
function persona(input: {
  id: string;
  name: string;
  background: string;
  style: string;
  experiences: Experience[];
  education: PersonaData["education"];
  skills: PersonaData["skills"];
  memory: [PersonaData["memory"][number]["category"], string][];
  chosen: PersonaData["paths"][number];
  explored: PersonaData["paths"][number];
  actions: [string, string];
}): EvalPersona {
  const data: PersonaData = {
    name: input.name,
    timezone: "Europe/London",
    bluntness: 3,
    experiences: input.experiences,
    education: input.education,
    skills: input.skills,
    memory: input.memory.map(([category, content]) => ({
      category,
      content,
      sensitive: false,
      status: "active",
    })),
    stories: [],
    paths: [input.chosen, input.explored],
    plan: {
      northStar: `Move toward ${input.chosen.title} within 18 months.`,
      pathTitle: input.chosen.title,
      milestones: [{ title: "Validate requirements and create a work sample", targetInWeeks: 8 }],
      actions: input.actions.map((title) => ({
        title,
        weekOffset: 0,
        milestoneIndex: 0,
        status: "todo",
      })),
    },
  };
  // Every seeded fact is visible to the judge, so ordinary use of profile context is not fabrication.
  const facts = [
    input.background,
    `Name: ${data.name}. Timezone: ${data.timezone}. Bluntness preference: ${data.bluntness}.`,
    ...data.experiences.map(
      (e) =>
        `${e.title} at ${e.organization}, ${e.startDate} to ${e.endDate ?? "present"}. ${e.highlights.join(" ")}`,
    ),
    ...data.education.map(
      (e) =>
        `${e.qualification} in ${e.field}, ${e.institution}, ${e.startDate} to ${e.endDate ?? "present"}.`,
    ),
    ...data.skills.map((s) => `${s.name}: ${s.level}.`),
    ...data.memory.map((m) => m.content),
    ...data.paths.map(
      (p) => `Career path available for exploration or selection: ${JSON.stringify(p)}.`,
    ),
    `Plan available in plan scenarios: ${JSON.stringify(data.plan)}. In missed-actions, these actions were also scheduled last week and remain todo.`,
  ];
  return {
    id: input.id,
    data,
    facts,
    brief: `${input.name}. ${facts.join(" ")} Speaking style: ${input.style}`,
  };
}

export const PERSONAS: EvalPersona[] = [
  persona({
    id: "career-changer",
    name: "Aisha Rahman",
    background: "Science teacher for nine years, considering instructional design.",
    style:
      "Reflective and curious; asks practical questions about transferring teaching experience.",
    experiences: [
      experience("Science Teacher", "Eastfield Secondary School", "2017-09-01", null, [
        "Designed science lessons and assessed student learning.",
      ]),
      experience("Teaching Assistant", "Eastfield Secondary School", "2016-09-01", "2017-08-31", [
        "Supported practical science lessons.",
      ]),
    ],
    education: [
      {
        institution: "University of Leeds",
        qualification: "BSc",
        field: "Chemistry",
        startDate: "2012-09-01",
        endDate: "2015-06-30",
      },
      {
        institution: "University of Leeds",
        qualification: "PGCE",
        field: "Secondary Science",
        startDate: "2015-09-01",
        endDate: "2016-06-30",
      },
    ],
    skills: [
      { name: "Lesson design", level: "strong" },
      { name: "Assessment", level: "strong" },
      { name: "Facilitation", level: "strong" },
      { name: "Science communication", level: "working" },
      { name: "Learning management systems", level: "working" },
    ],
    memory: [
      ["aspiration", "Wants to move from science teaching into instructional design."],
      ["constraint", "Can study four hours a week and needs to preserve a £35,000 annual income."],
      ["energizer", "Enjoys designing lessons that make difficult ideas accessible."],
      ["drain", "Evening marking is exhausting."],
    ],
    chosen: path(
      "Instructional Designer",
      "chosen",
      ["25-9031.00"],
      "Lesson design and assessment are transferable to learning design.",
      "E-learning authoring",
    ),
    explored: path(
      "Training and Development Specialist",
      "explored",
      ["13-1151.00"],
      "Facilitation could transfer to workplace training.",
      "Adult learning",
    ),
    actions: [
      "Review two instructional design vacancies for requirements",
      "Spend one hour outlining a science e-learning sample",
    ],
  }),
  persona({
    id: "new-grad",
    name: "Jordan Lee",
    background:
      "Graduated with a BSc Biology in 2026; works part-time as a barista and is weighing lab work against science communication.",
    style: "Tentative and conversational; interested in trying things before choosing.",
    experiences: [
      experience("Part-time Barista", "River Café", "2024-09-01", null, [
        "Serves customers and prepares drinks.",
      ]),
      experience(
        "Undergraduate Laboratory Student",
        "University of Bristol",
        "2023-09-01",
        "2026-06-30",
        ["Completed supervised biology practicals and wrote lab reports."],
      ),
    ],
    education: [
      {
        institution: "University of Bristol",
        qualification: "BSc",
        field: "Biology",
        startDate: "2023-09-01",
        endDate: "2026-06-30",
      },
    ],
    skills: [
      { name: "Basic laboratory techniques", level: "working" },
      { name: "Scientific writing", level: "working" },
      { name: "Data analysis", level: "basic" },
      { name: "Customer service", level: "working" },
      { name: "Biology", level: "working" },
    ],
    memory: [
      ["aspiration", "Unsure whether laboratory work or science communication is a better fit."],
      ["constraint", "Has a £100 learning budget and six hours a week while working part-time."],
      ["energizer", "Enjoys explaining biology to friends."],
      ["preference", "Wants short experiments with both career options before committing."],
    ],
    chosen: path(
      "Science Communicator",
      "chosen",
      ["27-3042.00"],
      "Scientific writing and explaining biology could support communication work.",
      "Public-facing writing",
    ),
    explored: path(
      "Biological Laboratory Technician",
      "explored",
      ["19-4021.00"],
      "Supervised undergraduate lab practice provides a starting point.",
      "Laboratory quality procedures",
    ),
    actions: [
      "Read two entry-level science communication vacancies",
      "Draft a 300-word explanation of a biology topic",
    ],
  }),
  persona({
    id: "burned-out-senior",
    name: "Elena Petrova",
    background: "Staff software engineer with fifteen years of experience; exhausted by work.",
    style: "Direct and tired; wary of another ambitious productivity plan.",
    experiences: [
      experience("Staff Software Engineer", "Cedar Systems", "2020-01-01", null, [
        "Guides system architecture and mentors engineers.",
      ]),
      experience("Senior Software Engineer", "Harbor Software", "2015-01-01", "2019-12-31", [
        "Built backend services and reviewed technical designs.",
      ]),
      experience("Software Engineer", "Harbor Software", "2011-01-01", "2014-12-31", [
        "Developed and maintained web applications.",
      ]),
    ],
    education: [
      {
        institution: "University of Manchester",
        qualification: "BSc",
        field: "Computer Science",
        startDate: "2007-09-01",
        endDate: "2010-06-30",
      },
    ],
    skills: [
      { name: "Software architecture", level: "expert" },
      { name: "Backend development", level: "expert" },
      { name: "Mentoring", level: "strong" },
      { name: "Technical writing", level: "strong" },
      { name: "System design", level: "expert" },
    ],
    memory: [
      ["drain", "Exhausted by on-call duties and constant delivery pressure."],
      [
        "constraint",
        "Needs time to recover; can spend at most one hour weekly on career exploration.",
      ],
      ["value", "Wants sustainable work with fewer interruptions."],
      [
        "energizer",
        "Still enjoys mentoring and explaining architecture when there is no deadline pressure.",
      ],
    ],
    chosen: path(
      "Technical Writer",
      "chosen",
      ["27-3042.00"],
      "Technical writing and engineering experience could transfer to documentation.",
      "Documentation portfolio",
    ),
    explored: path(
      "Software Development Mentor",
      "explored",
      ["13-1151.00"],
      "Mentoring is an energizing part of existing work.",
      "Training design",
    ),
    actions: [
      "Spend 20 minutes reviewing documentation roles for workload expectations",
      "Outline one short architecture explanation without a deadline",
    ],
  }),
  persona({
    id: "returning-parent",
    name: "Marcus Bell",
    background: "Chartered accountant returning after a six-year caregiving break.",
    style: "Careful and candid; asks about confidence, flexible hours, and refreshing skills.",
    experiences: [
      experience("Family Caregiver", "Family", "2020-01-01", null, [
        "Full-time caregiving during a six-year career break.",
      ]),
      experience("Management Accountant", "Birch Manufacturing", "2014-01-01", "2019-12-31", [
        "Prepared monthly management accounts and budgets.",
      ]),
      experience("Assistant Accountant", "Birch Manufacturing", "2010-01-01", "2013-12-31", [
        "Maintained ledgers and reconciled accounts.",
      ]),
    ],
    education: [
      {
        institution: "University of Nottingham",
        qualification: "BSc",
        field: "Accounting",
        startDate: "2006-09-01",
        endDate: "2009-06-30",
      },
      {
        institution: "ICAEW",
        qualification: "ACA",
        field: "Chartered Accountancy",
        startDate: "2010-01-01",
        endDate: "2013-12-31",
      },
    ],
    skills: [
      { name: "Management accounting", level: "strong" },
      { name: "Budgeting", level: "strong" },
      { name: "Financial reporting", level: "strong" },
      { name: "Spreadsheets", level: "working" },
      { name: "Account reconciliation", level: "strong" },
    ],
    memory: [
      ["aspiration", "Wants to return to accountancy after six years of caregiving."],
      ["constraint", "Needs school-hours work and can study three hours weekly."],
      ["preference", "Would prefer a supported return-to-work role."],
      ["drain", "Worries that accounting software and standards have moved on."],
    ],
    chosen: path(
      "Return-to-work Management Accountant",
      "chosen",
      ["13-2011.00"],
      "Prior management accounting experience supports a return with refresher training.",
      "Current accounting software",
    ),
    explored: path(
      "Bookkeeper",
      "explored",
      ["43-3031.00"],
      "Reconciliation skills could support a flexible bridge role.",
      "Current bookkeeping software",
    ),
    actions: [
      "Find two accountancy returner programmes with flexible hours",
      "Spend 45 minutes identifying accounting refresher topics",
    ],
  }),
  persona({
    id: "tradesperson",
    name: "Tomás Rivera",
    background:
      "Electrician with twelve years of experience, interested in estimating or project management.",
    style: "Plain-spoken and practical; wants examples that connect to work on site.",
    experiences: [
      experience("Electrician", "Westside Electrical", "2018-01-01", null, [
        "Installs and maintains electrical systems and reads wiring plans.",
      ]),
      experience("Electrician", "Oak Electrical", "2014-01-01", "2017-12-31", [
        "Completed residential electrical installations.",
      ]),
    ],
    education: [
      {
        institution: "City Technical College",
        qualification: "Electrical apprenticeship",
        field: "Electrical Installation",
        startDate: "2010-09-01",
        endDate: "2013-06-30",
      },
    ],
    skills: [
      { name: "Electrical installation", level: "expert" },
      { name: "Reading wiring plans", level: "strong" },
      { name: "Fault finding", level: "strong" },
      { name: "Site safety", level: "strong" },
      { name: "Materials planning", level: "working" },
    ],
    memory: [
      ["aspiration", "Wants to explore electrical estimating or project management."],
      ["drain", "Physical strain from site work is increasing."],
      ["constraint", "Must keep earning while retraining and has two hours weekly."],
      ["energizer", "Likes planning materials and solving site problems."],
    ],
    chosen: path(
      "Electrical Estimator",
      "chosen",
      ["13-1051.00"],
      "Electrical installation and materials planning provide relevant domain knowledge.",
      "Cost estimating software",
    ),
    explored: path(
      "Construction Project Manager",
      "explored",
      ["11-9021.00"],
      "Site knowledge could transfer with project planning training.",
      "Project scheduling",
    ),
    actions: [
      "Review two electrical estimating vacancies",
      "Spend one hour drafting a materials estimate for a familiar installation",
    ],
  }),
];
