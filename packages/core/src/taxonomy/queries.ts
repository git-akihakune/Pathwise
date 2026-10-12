import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db";

export interface OccupationSummary {
  id: string;
  source: "onet" | "esco";
  code: string;
  title: string;
  description: string;
}
export interface OccupationDetail extends OccupationSummary {
  altTitles: string[];
  tasks: string[];
  skills: { id: string; name: string; importance: number }[];
  related: OccupationSummary[];
}

type Row<T> = T & Record<string, unknown>;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.trunc(n)));

export async function searchOccupations(
  db: DbOrTx,
  query: string,
  opts: { limit?: number; source?: "onet" | "esco" } = {},
): Promise<OccupationSummary[]> {
  const q = query.trim();
  if (q === "") return [];
  const limit = clamp(opts.limit ?? 10, 1, 50);
  const sourceFilter = opts.source ? sql`and source = ${opts.source}` : sql``;
  const { rows } = await db.execute<Row<OccupationSummary>>(sql`
    select id, source, code, title, description
    from occupations, websearch_to_tsquery('english', ${q}) as tsq
    where search @@ tsq ${sourceFilter}
    order by (to_tsvector('english', title) @@ tsq) desc, ts_rank(search, tsq) desc, title asc
    limit ${limit}`);
  return rows;
}

export async function getOccupation(
  db: DbOrTx,
  idOrCode: string,
): Promise<OccupationDetail | null> {
  const found = await db.execute<
    Row<OccupationSummary & { altTitles: string[]; tasks: string[] }>
  >(sql`
    select id, source, code, title, description, alt_titles as "altTitles", tasks
    from occupations
    where id = ${idOrCode} or code = ${idOrCode}
    order by (source = 'onet') desc, id asc
    limit 1`);
  const occ = found.rows[0];
  if (!occ) return null;
  const skills = await db.execute<{ id: string; name: string; importance: number }>(sql`
    select s.id, s.name, os.importance
    from occupation_skills os
    join taxonomy_skills s on s.id = os.taxonomy_skill_id
    where os.occupation_id = ${occ.id}
    order by os.importance desc, s.name asc, s.id asc`);
  const related = await db.execute<Row<OccupationSummary>>(sql`
    select distinct o.id, o.source, o.code, o.title, o.description
    from occupation_relations r
    join occupations o on o.id = r.to_id
    where r.from_id = ${occ.id}
    order by o.title asc, o.id asc`);
  return { ...occ, skills: skills.rows, related: related.rows };
}

export async function searchTaxonomySkills(
  db: DbOrTx,
  query: string,
  limit = 10,
): Promise<{ id: string; name: string; source: "onet" | "esco" }[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const escaped = q.replace(/[\\%_]/g, "\\$&");
  const { rows } = await db.execute<{ id: string; name: string; source: "onet" | "esco" }>(sql`
    select id, name, source
    from taxonomy_skills, websearch_to_tsquery('english', ${q}) as tsq
    where search @@ tsq or name ilike ${`%${escaped}%`}
    order by (lower(name) = lower(${q})) desc,
             (name ilike ${`${escaped}%`}) desc,
             ts_rank(search, tsq) desc,
             name asc
    limit ${clamp(limit, 1, 50)}`);
  return rows;
}

export async function matchTaxonomySkill(db: DbOrTx, name: string): Promise<string | null> {
  const { rows } = await db.execute<{ id: string }>(sql`
    select id from taxonomy_skills
    where lower(name) = lower(${name.trim()})
    order by (source = 'onet') desc, id asc
    limit 1`);
  return rows[0]?.id ?? null;
}
