import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import type { AppConfig } from "../../config";
import { type DbOrTx, schema } from "../../db";
import { NotFoundError } from "../../errors";
import { JOBS, type JobQueue } from "../../jobs/queue";
import { type DocumentMime, sniffMime } from "./sniff";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PASTE_CHARS = 100_000;

export type DocumentKind = "cv" | "linkedin" | "other";
export type DocumentErrorCode =
  | "scanned"
  | "unreadable"
  | "no_provider"
  | "key_rejected"
  | "extraction_failed"
  | "timed_out";

export interface DocumentView {
  id: string;
  kind: DocumentKind;
  filename: string;
  mime: DocumentMime;
  status: "pending" | "parsed" | "failed";
  error: DocumentErrorCode | null;
  /** DocumentExtraction (Task 4). */
  extraction: unknown;
  createdAt: Date;
}

export type UploadRejection = "too_large" | "unsupported_type" | "empty" | "too_long";

export class UploadRejectedError extends Error {
  override name = "UploadRejectedError";
  readonly reason: UploadRejection;
  constructor(reason: UploadRejection) {
    super(UPLOAD_ERRORS[reason]);
    this.reason = reason;
  }
}

export const UPLOAD_ERRORS: Record<UploadRejection, string> = {
  too_large: "Files can be up to 10 MB.",
  unsupported_type: "Upload a PDF, a Word document (.docx), or a plain-text file.",
  empty: "That file is empty.",
  too_long: "Pasted text can be up to 100,000 characters.",
};

type DocDeps = { db: DbOrTx; config: Pick<AppConfig, "filesDir">; queue: JobQueue };
type Row = typeof schema.documents.$inferSelect;

const toView = (r: Row): DocumentView => ({
  id: r.id,
  kind: r.kind as DocumentKind,
  filename: r.filename,
  mime: r.mime as DocumentMime,
  status: r.status as DocumentView["status"],
  error: r.error as DocumentErrorCode | null,
  extraction: r.extraction ?? null,
  createdAt: r.createdAt,
});

function displayName(filename: string): string {
  const name = Array.from(
    basename(filename.replace(/\\/g, "/"))
      // Control characters (C0, DEL, C1) and bidi overrides/isolates/marks.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
      .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ""),
  )
    .slice(0, 200) // by code point, so a surrogate pair is never split
    .join("")
    .trim();
  return name && name !== "." && name !== ".." ? name : "Document";
}

const queueParse = (deps: DocDeps, userId: string, documentId: string) =>
  deps.queue.send(
    JOBS.documentParse,
    { userId, documentId },
    { singletonKey: `${JOBS.documentParse}:${documentId}` },
  );

export async function uploadDocument(
  deps: DocDeps,
  userId: string,
  input: { filename: string; kind: DocumentKind; bytes: Uint8Array },
): Promise<DocumentView> {
  const { bytes } = input;
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadRejectedError("too_large");
  if (bytes.length === 0) throw new UploadRejectedError("empty");
  const mime = sniffMime(bytes);
  if (!mime) throw new UploadRejectedError("unsupported_type");
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error("Invalid user id for file storage.");

  const dir = join(deps.config.filesDir, userId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const name = randomUUID();
  await writeFile(join(dir, name), bytes, { mode: 0o600 });
  let row: Row | undefined;
  try {
    [row] = await deps.db
      .insert(schema.documents)
      .values({
        userId,
        kind: input.kind,
        filename: displayName(input.filename),
        mime,
        sizeBytes: bytes.length,
        storagePath: `${userId}/${name}`,
      })
      .returning();
  } catch (err) {
    await unlink(join(dir, name)).catch(() => {});
    throw err;
  }
  if (!row) {
    await unlink(join(dir, name)).catch(() => {});
    throw new Error("Document insert returned no row.");
  }
  await queueParse(deps, userId, row.id);
  return toView(row);
}

export async function createPastedDocument(
  deps: DocDeps,
  userId: string,
  input: { text: string; kind: DocumentKind },
): Promise<DocumentView> {
  const text = input.text.trim();
  if (!text) throw new UploadRejectedError("empty");
  if (text.length > MAX_PASTE_CHARS) throw new UploadRejectedError("too_long");
  const [row] = await deps.db
    .insert(schema.documents)
    .values({
      userId,
      kind: input.kind,
      filename: "Pasted text",
      mime: "text/plain",
      sizeBytes: Buffer.byteLength(text, "utf8"),
      extractedText: text,
    })
    .returning();
  if (!row) throw new Error("Document insert returned no row.");
  await queueParse(deps, userId, row.id);
  return toView(row);
}

async function getRow(db: DbOrTx, userId: string, id: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.id, id), eq(schema.documents.userId, userId)));
  if (!row) throw new NotFoundError("Document not found.");
  return row;
}

export async function getDocument(db: DbOrTx, userId: string, id: string): Promise<DocumentView> {
  return toView(await getRow(db, userId, id));
}

export async function listDocuments(db: DbOrTx, userId: string): Promise<DocumentView[]> {
  const rows = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.userId, userId))
    .orderBy(desc(schema.documents.createdAt));
  return rows.map(toView);
}

/** The stored file's bytes, or null for pasted text. */
export async function readDocumentBytes(
  db: DbOrTx,
  config: Pick<AppConfig, "filesDir">,
  userId: string,
  id: string,
): Promise<Buffer | null> {
  const row = await getRow(db, userId, id);
  if (!row.storagePath) return null;
  // Defence in depth: the path must be this user's own `<userId>/<uuid>`.
  const [owner, file, ...rest] = row.storagePath.split("/");
  if (owner !== userId || !file || rest.length > 0 || !/^[0-9a-f-]{36}$/.test(file))
    throw new NotFoundError("Document not found.");
  return readFile(join(config.filesDir, row.storagePath));
}
