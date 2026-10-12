import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { FIXTURE } from "../../../../test/fixtures/taxonomy/records";
import { readJsonlGz, writeSnapshot } from "./snapshot";

const tmp = () => mkdtempSync(join(tmpdir(), "snap-"));
const ONET = { onet: { version: "31.0", url: "u", sha256: "s" }, esco: null, crosswalk: null };

it("writes gzipped JSONL with checksums and a deterministic, content-derived version", async () => {
  const dir = tmp();
  const m = await writeSnapshot(dir, FIXTURE, ONET);
  expect(m.version).toMatch(/^onet-31\.0-[0-9a-f]{8}$/);
  expect(m.files["occupation_skills.jsonl.gz"].rows).toBe(13);
  const rows: unknown[] = [];
  for await (const r of readJsonlGz(join(dir, "occupations.jsonl.gz"))) rows.push(r);
  expect(rows).toEqual(FIXTURE.occupations);
  expect((await writeSnapshot(tmp(), FIXTURE, ONET)).version).toBe(m.version);
});
it("refuses to write anything over the size limit", async () => {
  const dir = tmp();
  await expect(writeSnapshot(dir, FIXTURE, ONET, { maxBytes: 100 })).rejects.toThrow(
    /the limit is/,
  );
  expect(existsSync(join(dir, "manifest.json"))).toBe(false);
});
