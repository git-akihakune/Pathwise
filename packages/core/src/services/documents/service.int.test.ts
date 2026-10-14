import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { makePdf } from "../../../../../test/fixtures/documents";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { seedUser, workflowDeps } from "../../../../../test/integration/fixtures";
import { schema } from "../../db";
import { NotFoundError } from "../../errors";
import {
  createPastedDocument,
  getDocument,
  listDocuments,
  MAX_UPLOAD_BYTES,
  readDocumentBytes,
  uploadDocument,
} from ".";

const db = getTestDb();
let deps: ReturnType<typeof workflowDeps>;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  await seedUser(db, "u2");
  deps = workflowDeps(db);
});

describe("documents", () => {
  it("stores uploads privately under a random name and queues parsing", async () => {
    const doc = await uploadDocument(deps, "u1", {
      filename: "../../etc/cv.pdf",
      kind: "cv",
      bytes: makePdf("Jane"),
    });
    expect(doc).toMatchObject({
      status: "pending",
      mime: "application/pdf",
      filename: "cv.pdf",
      kind: "cv",
    });
    const [row] = await db.select().from(schema.documents);
    const storagePath = row?.storagePath ?? "";
    expect(storagePath).toMatch(/^u1\/[0-9a-f-]{36}$/);
    expect(statSync(join(deps.config.filesDir, storagePath)).mode & 0o777).toBe(0o600);
    expect(deps.queue.sent).toEqual([
      {
        name: "document.parse",
        data: { userId: "u1", documentId: doc.id },
        opts: { singletonKey: `document.parse:${doc.id}` },
      },
    ]);
  });
  it("accepts exactly 10 MB and rejects one byte more without writing (Review Focus 3)", async () => {
    await uploadDocument(deps, "u1", {
      filename: "a.txt",
      kind: "other",
      bytes: Buffer.alloc(MAX_UPLOAD_BYTES, "a"),
    });
    await expect(
      uploadDocument(deps, "u1", {
        filename: "b.txt",
        kind: "other",
        bytes: Buffer.alloc(MAX_UPLOAD_BYTES + 1, "a"),
      }),
    ).rejects.toMatchObject({ reason: "too_large" });
    expect(readdirSync(join(deps.config.filesDir, "u1"))).toHaveLength(1);
  });
  it("judges by content, not by name (Review Focus 3)", async () => {
    await expect(
      uploadDocument(deps, "u1", { filename: "cv.pdf", kind: "cv", bytes: PNG }),
    ).rejects.toMatchObject({ reason: "unsupported_type" });
    await expect(
      uploadDocument(deps, "u1", { filename: "cv.pdf", kind: "cv", bytes: Buffer.alloc(0) }),
    ).rejects.toMatchObject({ reason: "empty" });
    expect(await db.$count(schema.documents)).toBe(0);
  });
  it("creates pasted-text documents without a file", async () => {
    const doc = await createPastedDocument(deps, "u1", {
      text: "Jane Doe\nStaff Nurse",
      kind: "linkedin",
    });
    expect(doc).toMatchObject({ filename: "Pasted text", mime: "text/plain", status: "pending" });
    const [row] = await db.select().from(schema.documents);
    expect(row).toMatchObject({ storagePath: null, extractedText: "Jane Doe\nStaff Nurse" });
    await expect(
      createPastedDocument(deps, "u1", { text: "x".repeat(100_001), kind: "cv" }),
    ).rejects.toMatchObject({ reason: "too_long" });
    await expect(
      createPastedDocument(deps, "u1", { text: "  \n ", kind: "cv" }),
    ).rejects.toMatchObject({ reason: "empty" });
  });
  it("cleans display names of control and bidi characters without splitting surrogates", async () => {
    const name = `a\u0085b\u202ec\u2066d\u200fe${"😀".repeat(250)}`;
    const doc = await uploadDocument(deps, "u1", {
      filename: name,
      kind: "cv",
      bytes: makePdf("x"),
    });
    expect(doc.filename).toBe(`abcde${"😀".repeat(195)}`);
  });
  it("scopes documents to their owner", async () => {
    const doc = await createPastedDocument(deps, "u1", { text: "Jane", kind: "cv" });
    await expect(getDocument(db, "u2", doc.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listDocuments(db, "u2")).toEqual([]);
  });
  it("reads stored bytes only for the owner, and null for pasted text", async () => {
    const pdf = makePdf("Jane");
    const doc = await uploadDocument(deps, "u1", { filename: "cv.pdf", kind: "cv", bytes: pdf });
    expect(await readDocumentBytes(db, deps.config, "u1", doc.id)).toEqual(pdf);
    await expect(readDocumentBytes(db, deps.config, "u2", doc.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const pasted = await createPastedDocument(deps, "u1", { text: "Jane", kind: "cv" });
    expect(await readDocumentBytes(db, deps.config, "u1", pasted.id)).toBeNull();
  });
});
