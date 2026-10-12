import { expect, it } from "vitest";
import { crosswalkRelations } from "./crosswalk";
import { escoOccupationSkills, escoOccupations, escoSkills } from "./esco";

const U = "http://data.europa.eu/esco";
const OCC = `conceptType,conceptUri,preferredLabel,altLabels,status,description,code
Occupation,${U}/occupation/aaa-111,software developer,"programmer\ncoder\nProgrammer",released,Implements software.,2512.4`;
const SKILLS = `conceptType,conceptUri,skillType,preferredLabel,status,description
KnowledgeSkillCompetence,${U}/skill/s-1,skill/competence,Python (computer programming),released,Python.
KnowledgeSkillCompetence,${U}/skill/s-2,skill/competence,old skill,obsolete,Gone.`;
const REL = `occupationUri,relationType,skillType,skillUri
${U}/occupation/aaa-111,essential,skill/competence,${U}/skill/s-1
${U}/occupation/aaa-111,optional,skill/competence,${U}/skill/s-2
${U}/occupation/zzz-999,optional,skill/competence,${U}/skill/s-1`;

it("reduces ESCO occupations and released skills", () => {
  expect(escoOccupations(OCC)).toEqual([
    {
      id: "esco:aaa-111",
      source: "esco",
      code: "2512.4",
      title: "software developer",
      description: "Implements software.",
      altTitles: ["programmer", "coder"],
      tasks: [],
    },
  ]);
  expect(escoSkills(SKILLS).map((s) => s.id)).toEqual(["esco:s-1"]);
});
it("maps essential to 1.0, optional to 0.5, and drops unknown ids", () => {
  expect(escoOccupationSkills(REL, new Set(["esco:aaa-111"]), new Set(["esco:s-1"]))).toEqual([
    { occupationId: "esco:aaa-111", skillId: "esco:s-1", importance: 1, level: null },
  ]);
});
it("finds crosswalk columns by their values and links both directions", () => {
  const cw = `ESCO Occupation URI,ESCO Title,O*NET Id,O*NET Title,Match
${U}/occupation/aaa-111,software developer,15-1252.00,Software Developers,exactMatch
${U}/occupation/zzz-999,unknown,15-1252.00,Software Developers,closeMatch`;
  expect(crosswalkRelations(cw, new Set(["esco:aaa-111", "onet:15-1252.00"]))).toEqual([
    { fromId: "esco:aaa-111", toId: "onet:15-1252.00", kind: "crosswalk" },
    { fromId: "onet:15-1252.00", toId: "esco:aaa-111", kind: "crosswalk" },
  ]);
});
