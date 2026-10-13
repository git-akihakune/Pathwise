import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { schema } from "../../db";
import { NotFoundError } from "../../errors";
import { seedDemo } from "../../seed";
import { EXPORT_EXCLUDED_TABLES, EXPORT_TABLES, exportUserData } from ".";

const db = getTestDb();
const NOW = new Date("2026-10-14T09:00:00Z");
let userId: string;
let filesDir: string;

async function addDocument(filename: string, bytes?: string, owner = userId) {
  const storagePath = `${owner}/${randomUUID()}`;
  if (bytes !== undefined) {
    mkdirSync(join(filesDir, owner), { recursive: true });
    writeFileSync(join(filesDir, storagePath), bytes);
  }
  await db.insert(schema.documents).values({
    userId: owner,
    kind: "cv",
    filename,
    mime: "application/pdf",
    sizeBytes: bytes?.length ?? 0,
    storagePath,
    status: "parsed",
  });
  return storagePath;
}

async function exported() {
  const zip = unzipSync(await exportUserData(db, userId, { filesDir, now: NOW }));
  const bundle = zip["pathwise-export.json"];
  assert(bundle, "The ZIP must contain pathwise-export.json.");
  const json = strFromU8(bundle);
  const data = JSON.parse(json) as {
    meta: { schemaVersion: number; missingFiles: string[] };
    tables: Record<string, Record<string, unknown>[]>;
  };
  return { zip, json, data };
}

beforeEach(async () => {
  await resetDb(db);
  filesDir = mkdtempSync(join(tmpdir(), "pw-export-"));
  userId = (await seedDemo({ db }, { now: NOW })).userId;
});
afterEach(() => rmSync(filesDir, { recursive: true, force: true }));

describe("exportUserData", () => {
  it("bundles the user's rows and original files", async () => {
    await addDocument("Maya CV.pdf", "CV BYTES");
    const { zip, data } = await exported();
    expect(data.meta).toMatchObject({
      app: "pathwise",
      formatVersion: 1,
      exportedAt: NOW.toISOString(),
      userId,
      missingFiles: [],
    });
    expect(data.meta.schemaVersion).toBeGreaterThan(0);
    expect(data.tables.user).toEqual([
      expect.objectContaining({ email: "demo@pathwise.local", role: "user" }),
    ]);
    const user = data.tables.user?.[0];
    assert(user, "The export must contain the user's identity row.");
    expect(Object.keys(user).sort()).toEqual([
      "createdAt",
      "email",
      "emailVerified",
      "id",
      "name",
      "role",
    ]);
    expect(data.tables.experiences).toHaveLength(3);
    expect(data.tables.stories).toHaveLength(2);
    expect(data.tables.documents).toHaveLength(1);
    const original = zip["files/Maya CV.pdf"];
    assert(original, "The ZIP must contain the uploaded CV.");
    expect(strFromU8(original)).toBe("CV BYTES");
  });

  it("exports every user_id table unless credentials are explicitly excluded", async () => {
    const { rows } = await db.execute<{ table_name: string }>(sql`
      select distinct table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'user_id'`);
    const { data } = await exported();
    for (const { table_name } of rows) {
      if (Object.hasOwn(EXPORT_EXCLUDED_TABLES, table_name)) {
        expect(data.tables, table_name).not.toHaveProperty(table_name);
      } else {
        expect(EXPORT_TABLES, table_name).toHaveProperty(table_name);
        const { rows: owned } = await db.execute(sql`
          select * from ${sql.identifier(table_name)} where user_id = ${userId}`);
        expect(data.tables[table_name], table_name).toHaveLength(owned.length);
      }
    }
  });

  it("excludes credentials and derived vector and search columns", async () => {
    await db.insert(schema.providerConfigs).values({
      userId,
      kind: "openai",
      label: "Mine",
      encryptedKey: "SECRET-CIPHERTEXT",
      models: { main: "m", fast: "f" },
    });
    await db.insert(schema.session).values({
      id: "s1",
      token: "SESSION-TOKEN",
      userId,
      expiresAt: new Date("2030-01-01"),
      updatedAt: NOW,
    });
    await db
      .update(schema.account)
      .set({ password: "SECRET-PASSWORD", accessToken: "SECRET-ACCESS-TOKEN" })
      .where(eq(schema.account.userId, userId));
    const { json, data } = await exported();
    expect(json).not.toMatch(
      /SECRET-CIPHERTEXT|SESSION-TOKEN|SECRET-PASSWORD|SECRET-ACCESS-TOKEN|"encryptedKey"|"password"|"token"/,
    );
    expect(data.tables).not.toHaveProperty("account");
    expect(data.tables).not.toHaveProperty("session");
    expect(data.tables.provider_configs).toEqual([
      expect.objectContaining({ label: "Mine", kind: "openai" }),
    ]);
    expect(json).not.toMatch(/"embedding"|"summaryEmbedding"|"summarySearch"|"search"/);
  });

  it("records missing uploads without failing the export", async () => {
    await addDocument("cv.pdf");
    const { zip, data } = await exported();
    expect(data.meta.missingFiles).toEqual(["cv.pdf"]);
    expect(Object.keys(zip)).toEqual(["pathwise-export.json"]);
  });

  it("exports pasted text in JSON without reporting a missing file", async () => {
    await db.insert(schema.documents).values({
      userId,
      kind: "cv",
      filename: "Pasted text",
      mime: "text/plain",
      sizeBytes: 4,
      extractedText: "TEXT",
      status: "parsed",
    });
    const { zip, data } = await exported();
    expect(data.tables.documents).toEqual([
      expect.objectContaining({ extractedText: "TEXT", storagePath: null }),
    ]);
    expect(data.meta.missingFiles).toEqual([]);
    expect(Object.keys(zip)).toEqual(["pathwise-export.json"]);
  });

  it("sanitizes filenames including Windows paths, dot names and collisions", async () => {
    for (const name of [
      "../cv.pdf",
      "cv.pdf",
      "cv (2).pdf",
      "C:\\private\\cv.pdf",
      ".",
      "..",
      "   ",
      "résumé?.pdf",
    ])
      await addDocument(name, name);
    const { zip } = await exported();
    expect(
      Object.keys(zip)
        .filter((k) => k.startsWith("files/"))
        .sort(),
    ).toEqual([
      "files/cv (2) (2).pdf",
      "files/cv (2).pdf",
      "files/cv (3).pdf",
      "files/cv.pdf",
      "files/file",
      "files/file (2)",
      "files/file (3)",
      "files/r_sum__.pdf",
    ]);
    const original = zip["files/cv.pdf"];
    assert(original, "The ZIP must contain the first sanitized CV.");
    expect(strFromU8(original)).toBe("../cv.pdf");
    expect(Object.values(zip)).toHaveLength(9);
  });

  it("never exports other users' rows, files or the instance provider", async () => {
    const other = (await seedDemo({ db }, { email: "other@example.com", now: NOW })).userId;
    await addDocument("mine.pdf", "MY FILE");
    await addDocument("private.pdf", "OTHER PRIVATE FILE", other);
    for (const owner of [userId, other]) {
      await db.insert(schema.llmUsage).values({
        userId: owner,
        model: "m",
        role: "main",
        purpose: "coach",
        inputTokens: 10,
        outputTokens: 5,
      });
      await db
        .insert(schema.userSnapshot)
        .values({ userId: owner, content: `Snapshot ${owner}`, profileVersion: 1 });
      await db.insert(schema.checkins).values({ userId: owner, weekOf: "2026-10-12", dueAt: NOW });
    }
    await db.insert(schema.providerConfigs).values([
      {
        userId,
        kind: "openai",
        label: "MY PROVIDER",
        models: { main: "m", fast: "f" },
      },
      { userId: other, kind: "openai", label: "OTHER PROVIDER", models: { main: "m", fast: "f" } },
      {
        userId: null,
        kind: "openai",
        label: "INSTANCE PROVIDER",
        models: { main: "m", fast: "f" },
      },
    ]);
    const { zip, json, data } = await exported();
    expect(json).not.toContain(other);
    expect(json).not.toMatch(/other@example.com|OTHER PROVIDER|INSTANCE PROVIDER|private.pdf/);
    expect(Object.keys(zip).sort()).toEqual(["files/mine.pdf", "pathwise-export.json"]);
    for (const [name, table] of Object.entries(EXPORT_TABLES)) {
      const columns = getTableColumns(table);
      const expected = await db.select().from(table).where(eq(columns.userId, userId));
      expect(data.tables[name], name).toHaveLength(expected.length);
      const exportedRows = data.tables[name];
      assert(exportedRows, `The export must contain the ${name} table.`);
      for (const row of exportedRows) expect(row.userId, name).toBe(userId);
    }
  });

  it("refuses a stored path belonging to another user", async () => {
    const other = (await seedDemo({ db }, { email: "other@example.com", now: NOW })).userId;
    const storagePath = await addDocument("private.pdf", "OTHER PRIVATE FILE", other);
    await db.insert(schema.documents).values({
      userId,
      kind: "cv",
      filename: "stolen.pdf",
      mime: "application/pdf",
      sizeBytes: 18,
      storagePath,
    });
    await expect(exported()).rejects.toBeInstanceOf(NotFoundError);
  });

  it("propagates non-missing filesystem errors", async () => {
    const storagePath = await addDocument("directory.pdf");
    mkdirSync(join(filesDir, storagePath), { recursive: true });
    await expect(exported()).rejects.toMatchObject({ code: "EISDIR" });
  });
});
