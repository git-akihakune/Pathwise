// Runs inside a forked child process (see read.ts). Self-contained on purpose: it is loaded directly by
// Node in development/tests and bundled as its own entry for the worker image, so it imports no
// sibling modules.
import { Unzip, UnzipInflate, UnzipPassThrough, zipSync } from "fflate";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export const MAX_ZIP_ENTRIES = 2000;
export const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_PAGES = 100;
/** Stored extracted text is cut here, however much the file holds. */
export const MAX_TEXT_CHARS = 200_000;
export type ReadFailure =
  | "too_large"
  | "entries"
  | "pages"
  | "timeout"
  | "memory"
  | "crash"
  | "unreadable";
/** A deliberate rejection with a fixed, content-free code. */
export class ReadError extends Error {
  override name = "ReadError";
  readonly code: ReadFailure;
  constructor(message: string, code: ReadFailure) {
    super(message);
    this.code = code;
  }
}
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Inflates every entry ourselves, counting the bytes actually produced (declared sizes are
 * attacker-controlled), and returns an honest store-only archive for mammoth/JSZip.
 */
function inflateBounded(bytes: Uint8Array): Uint8Array {
  const STOP = new Error("stop");
  const files: Record<string, Uint8Array> = {};
  let entries = 0;
  let total = 0;
  let problem: ReadError | null = null;
  const unzip = new Unzip((file) => {
    if (file.name.endsWith("/")) return;
    entries += 1;
    if (entries > MAX_ZIP_ENTRIES) {
      problem = new ReadError("The document has too many entries.", "entries");
      throw STOP;
    }
    const chunks: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      total += chunk.length;
      if (total > MAX_DOCX_UNCOMPRESSED_BYTES) {
        problem = new ReadError("The document is too large when unpacked.", "too_large");
        throw STOP;
      }
      chunks.push(chunk);
      if (final) files[file.name] = Buffer.concat(chunks);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  try {
    const STEP = 64 * 1024;
    for (let i = 0; i < bytes.length; i += STEP) {
      unzip.push(bytes.subarray(i, i + STEP), i + STEP >= bytes.length);
    }
  } catch (err) {
    if (err !== STOP) throw err;
  }
  if (problem) throw problem;
  return zipSync(files, { level: 0 });
}

/** Plain text of a file. Throws when it is damaged or over the safety limits. */
export async function readInline(bytes: Uint8Array, mime: string): Promise<string> {
  let text: string;
  if (mime === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      if (pdf.numPages > MAX_PDF_PAGES)
        throw new ReadError(`The PDF has more than ${MAX_PDF_PAGES} pages.`, "pages");
      text = (await extractText(pdf, { mergePages: true })).text;
    } finally {
      await pdf.cleanup();
    }
  } else if (mime === DOCX_MIME) {
    const safe = inflateBounded(bytes);
    text = (await mammoth.extractRawText({ buffer: Buffer.from(safe) })).value;
  } else {
    text = Buffer.from(bytes).toString("utf8").replace(/^﻿/, "");
  }
  return text.slice(0, MAX_TEXT_CHARS);
}

if (process.env.PATHWISE_READ_CHILD === "1" && process.send) {
  const send = process.send.bind(process);
  process.once("message", async (m: { bytes: Uint8Array; mime: string }) => {
    // Test hooks (set only by read.test.ts): simulate a hung or crashing reader.
    if (process.env.PATHWISE_READ_TEST === "hang") setInterval(() => {}, 1000);
    else if (process.env.PATHWISE_READ_TEST === "crash") process.exit(3);
    else {
      let reply: { ok: boolean; text?: string; error?: string; code?: ReadFailure };
      try {
        reply = { ok: true, text: await readInline(m.bytes, m.mime) };
      } catch (e) {
        reply = {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          code: e instanceof ReadError ? e.code : "unreadable",
        };
      }
      send(reply, () => process.exit(0));
    }
  });
}
