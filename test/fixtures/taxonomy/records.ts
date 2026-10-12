import type {
  OccupationRecord,
  OccupationSkillRecord,
  SkillRecord,
  SnapshotData,
} from "../../../packages/core/src/taxonomy/snapshot";

const skill = (source: "onet" | "esco", code: string, name: string, description: string) =>
  ({ id: `${source}:${code}`, source, code, name, description }) satisfies SkillRecord;

const skills: SkillRecord[] = [
  skill("onet", "2.B.3.e", "Programming", "Writing computer programs for various purposes."),
  skill("onet", "2.A.2.a", "Critical Thinking", "Using logic to weigh the strengths of solutions."),
  skill("onet", "2.B.1.f", "Service Orientation", "Actively looking for ways to help people."),
  skill(
    "onet",
    "2.C.3.a",
    "Computers and Electronics",
    "Knowledge of circuit boards, processors, and software.",
  ),
  skill(
    "onet",
    "2.C.5.a",
    "Medicine and Dentistry",
    "Knowledge of diagnosing and treating illness.",
  ),
  skill("onet", "2.A.1.e", "Mathematics", "Using mathematics to solve problems."),
  skill("onet", "2.C.4.a", "Mathematics", "Knowledge of arithmetic, algebra, and geometry."),
  skill(
    "esco",
    "skill-python",
    "Python (computer programming)",
    "Methods and techniques of programming in Python.",
  ),
];

const occupations: OccupationRecord[] = [
  {
    id: "onet:15-1252.00",
    source: "onet",
    code: "15-1252.00",
    title: "Software Developers",
    description:
      "Research, design, and develop computer and network software or specialized utility programs.",
    altTitles: ["Software Engineer", "Application Developer"],
    tasks: [
      "Modify existing software to correct errors.",
      "Analyze user needs and software requirements.",
    ],
  },
  {
    id: "onet:15-1253.00",
    source: "onet",
    code: "15-1253.00",
    title: "Software Quality Assurance Analysts and Testers",
    description:
      "Develop and execute software tests to identify software problems and their causes.",
    altTitles: ["QA Tester"],
    tasks: [],
  },
  {
    id: "onet:29-1141.00",
    source: "onet",
    code: "29-1141.00",
    title: "Registered Nurses",
    description:
      "Assess patient health problems and needs, develop and implement nursing care plans, and maintain medical records.",
    altTitles: ["RN", "Staff Nurse"],
    tasks: [],
  },
  {
    id: "onet:11-9111.00",
    source: "onet",
    code: "11-9111.00",
    title: "Medical and Health Services Managers",
    description:
      "Plan, direct, or coordinate medical and health services in hospitals, clinics, or similar organizations.",
    altTitles: ["Clinic Manager"],
    tasks: [],
  },
  {
    id: "esco:occ-software-developer",
    source: "esco",
    code: "2512.4",
    title: "software developer",
    description: "Software developers implement or program all kinds of software systems.",
    altTitles: ["programmer", "software engineer"],
    tasks: [],
  },
];

const os = (occ: string, skillId: string, importance: number): OccupationSkillRecord => ({
  occupationId: occ,
  skillId,
  importance,
  level: null,
});

const occupationSkills: OccupationSkillRecord[] = [
  os("onet:15-1252.00", "onet:2.B.3.e", 0.94),
  os("onet:15-1252.00", "onet:2.C.3.a", 0.88),
  os("onet:15-1252.00", "onet:2.A.2.a", 0.72),
  os("onet:15-1252.00", "onet:2.C.4.a", 0.55),
  os("onet:15-1252.00", "onet:2.B.1.f", 0.31),
  os("onet:15-1253.00", "onet:2.B.3.e", 0.62),
  os("onet:15-1253.00", "onet:2.A.2.a", 0.7),
  os("onet:29-1141.00", "onet:2.B.1.f", 0.85),
  os("onet:29-1141.00", "onet:2.A.2.a", 0.8),
  os("onet:29-1141.00", "onet:2.C.5.a", 0.78),
  os("onet:11-9111.00", "onet:2.A.2.a", 0.75),
  os("onet:11-9111.00", "onet:2.B.1.f", 0.6),
  os("esco:occ-software-developer", "esco:skill-python", 1),
];

export const FIXTURE: SnapshotData = {
  occupations,
  skills,
  occupationSkills,
  relations: [
    { fromId: "onet:15-1252.00", toId: "onet:15-1253.00", kind: "related" },
    { fromId: "onet:29-1141.00", toId: "onet:11-9111.00", kind: "related" },
    { fromId: "esco:occ-software-developer", toId: "onet:15-1252.00", kind: "crosswalk" },
    { fromId: "onet:15-1252.00", toId: "esco:occ-software-developer", kind: "crosswalk" },
  ],
};
