import type { PersonaData } from "./types";

export const DEMO_PERSONA: PersonaData = {
  name: "Maya Okafor",
  timezone: "Europe/London",
  bluntness: 3,
  experiences: [
    {
      title: "General Manager",
      organization: "The Larder House",
      startDate: "2019-03-01",
      endDate: null,
      highlights: [
        "Mapped the guest journey and cut complaints by 30% in six months",
        "Hired and trained a team of 18",
      ],
    },
    {
      title: "Assistant Manager",
      organization: "Harbourside Hotel",
      startDate: "2015-06-01",
      endDate: "2019-02-28",
      highlights: ["Ran monthly guest feedback panels"],
    },
    {
      title: "Front of House Supervisor",
      organization: "Brightside Café",
      startDate: "2012-09-01",
      endDate: "2015-05-31",
      highlights: [],
    },
  ],
  education: [
    {
      institution: "University of Leeds",
      qualification: "BSc",
      field: "Psychology",
      startDate: "2009-09-01",
      endDate: "2012-06-30",
    },
    {
      institution: "Online course",
      qualification: "Certificate",
      field: "UX Research Fundamentals",
      startDate: "2026-09-01",
      endDate: null,
    },
  ],
  skills: [
    { name: "Customer experience", level: "expert" },
    { name: "Staff training", level: "strong" },
    { name: "Conflict resolution", level: "strong" },
    { name: "Interviewing", level: "working" },
    { name: "Data analysis", level: "working" },
    { name: "Survey design", level: "basic" },
    { name: "Usability testing", level: "basic" },
  ],
  memory: [
    {
      category: "value",
      content: "Wants work where listening to people changes what gets built.",
      sensitive: false,
      status: "active",
    },
    {
      category: "constraint",
      content: "Needs to keep income above £38,000 a year while retraining.",
      sensitive: false,
      status: "active",
    },
    {
      category: "constraint",
      content: "Can study about six hours a week, mostly Tuesday to Thursday evenings.",
      sensitive: false,
      status: "active",
    },
    {
      category: "energizer",
      content: "Comes alive running guest feedback sessions and spotting patterns.",
      sensitive: false,
      status: "active",
    },
    {
      category: "drain",
      content: "Late closing shifts and weekend rotas.",
      sensitive: false,
      status: "active",
    },
    {
      category: "aspiration",
      content: "A UX researcher role at a product company within 18 months.",
      sensitive: false,
      status: "active",
    },
    {
      category: "preference",
      content: "Prefers concrete weekly steps over big-picture talk.",
      sensitive: false,
      status: "active",
    },
    {
      category: "observation",
      content: "Seems worried that a career change could strain the family budget.",
      sensitive: true,
      status: "pending",
    },
  ],
  stories: [
    {
      title: "Fixing the guest feedback loop",
      situation: "complaints doubled after a menu change and nobody knew why.",
      task: "find and fix the cause before summer.",
      action:
        "interviewed 25 regulars, mapped the guest journey, ran two-week trials with the team.",
      result: "complaints fell 30% in six months and repeat bookings rose.",
      metrics: "−30% complaints in 6 months",
      skills: ["Interviewing", "Customer experience", "Data analysis"],
    },
    {
      title: "Reopening with a new team",
      situation: "reopened after a six-month closure with 12 new hires.",
      task: "service-ready in three weeks.",
      action: "role-play training on real guest scenarios, each hire paired with a veteran.",
      result: "opened on schedule, 4.7/5 average reviews in the first quarter.",
      metrics: "12 hires trained in 3 weeks; 4.7/5 reviews",
      skills: ["Staff training", "Customer experience"],
    },
  ],
  paths: [
    {
      title: "UX Researcher via a customer-insights bridge role",
      status: "chosen",
      occupationCodes: ["19-3022.00", "13-1161.00"],
      rationale: "guest research is user research in all but name; psychology covers study design.",
      route: [
        {
          title: "Finish UX Research Fundamentals",
          kind: "learning",
          detail: "",
          isBridgeRole: false,
        },
        {
          title: "Run a usability study on a restaurant booking flow",
          kind: "project",
          detail: "",
          isBridgeRole: false,
        },
        {
          title: "Customer Insights Analyst at a hospitality-tech company",
          kind: "role",
          detail: "",
          isBridgeRole: true,
        },
        { title: "UX Researcher", kind: "role", detail: "", isBridgeRole: false },
      ],
      skillGaps: [
        { skill: "Usability testing", importance: 0.9, taxonomySkillId: null, note: "" },
        { skill: "Research synthesis", importance: 0.8, taxonomySkillId: null, note: "" },
        { skill: "Survey design", importance: 0.7, taxonomySkillId: null, note: "" },
      ],
      feasibility: {
        timeMonths: { min: 12, max: 18 },
        cost: "About £300 for courses, plus evenings for portfolio projects",
        risks: ["Junior UX research roles are competitive", "A bridge role may pay less at first"],
        mustBeTrue: ["Two portfolio case studies by month 6", "Keep about six study hours a week"],
      },
    },
    {
      title: "Customer Experience Manager at a tech company",
      status: "explored",
      occupationCodes: ["13-1161.00"],
      rationale:
        "uses CX strengths directly with little retraining but stays further from research.",
      route: [
        { title: "Customer Experience Manager", kind: "role", detail: "", isBridgeRole: false },
      ],
      skillGaps: [{ skill: "CRM software", importance: 0.6, taxonomySkillId: null, note: "" }],
      feasibility: {
        timeMonths: { min: 3, max: 6 },
        cost: "Little to none",
        risks: ["Some evening work remains"],
        mustBeTrue: ["Tech companies value hospitality CX experience"],
      },
    },
  ],
  plan: {
    northStar: "Work as a UX researcher at a product company within 18 months.",
    pathTitle: "UX Researcher via a customer-insights bridge role",
    milestones: [
      { title: "Finish UX Research Fundamentals", targetInWeeks: 6 },
      { title: "Publish two portfolio case studies", targetInWeeks: 20 },
      { title: "Land a customer-insights bridge role", targetInWeeks: 36 },
    ],
    actions: [
      {
        title: "Complete modules 3 and 4 of the UX research course",
        milestoneIndex: 0,
        weekOffset: 0,
        status: "todo",
      },
      {
        title: "Draft five interview questions for the booking-flow study",
        milestoneIndex: 1,
        weekOffset: 0,
        status: "todo",
      },
      {
        title: "Message two former guests who work in tech for a 20-minute chat",
        milestoneIndex: 2,
        weekOffset: 0,
        status: "todo",
      },
      {
        title: "Sign up for UX Research Fundamentals",
        milestoneIndex: 0,
        weekOffset: -1,
        status: "done",
      },
    ],
  },
  sessions: [
    {
      topic: "Getting started",
      daysAgo: 6,
      messages: [
        {
          role: "user",
          text: "I've managed restaurants for ten years and I'm tired of the late nights. I keep wondering if there's something else I'd be good at.",
        },
        {
          role: "assistant",
          text: "Ten years is a lot of experience to build on. When you think about the parts of the job you'd miss, what comes to mind first?",
        },
        {
          role: "user",
          text: "Honestly, the guest feedback sessions. Working out why people were unhappy and fixing it.",
        },
        {
          role: "assistant",
          text: "That sounds like the heart of user research: listening, spotting patterns, and changing what gets built. Would you like to explore paths that use that?",
        },
      ],
    },
    {
      topic: "Choosing a direction",
      daysAgo: 2,
      messages: [
        {
          role: "user",
          text: "I looked at the two paths. The UX researcher one excites me, but I can't take a big pay cut.",
        },
        {
          role: "assistant",
          text: "That's an important constraint. A customer-insights role at a hospitality-tech company could bridge the gap while you build a portfolio. Shall we plan around that?",
        },
        {
          role: "user",
          text: "Yes, let's do that. Small steps, please. I only have a few evenings a week.",
        },
        {
          role: "assistant",
          text: "I've drafted a plan with three milestones and three actions for this week. Each one fits into a single evening.",
        },
      ],
    },
  ],
  pendingStoryProposals: [
    {
      title: "Running monthly guest feedback panels",
      situation: "at Harbourside Hotel feedback only arrived as online reviews.",
      task: "hear from guests before they left.",
      action: "a monthly panel of eight guests with a short structured discussion.",
      result: "two service changes came straight from the panels.",
      skills: ["Interviewing", "Customer experience"],
    },
  ],
};
