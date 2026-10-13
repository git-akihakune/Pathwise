// Runs inside a worker thread (see read.ts). Self-contained on purpose: it is loaded directly by
// Node in development/tests and bundled as its own entry for the worker image, so it imports no
// sibling modules.
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { Unzip, UnzipInflate, UnzipPassThrough, zipSync } from "fflate";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export const MAX_ZIP_ENTRIES = 2000;
export const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_PAGES = 100;
/** Stored extracted text is cut here, however much the file holds. */
export const MAX_TEXT_CHARS = 200_000;
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
  let problem: string | null = null;
  const unzip = new Unzip((file) => {
    if (file.name.endsWith("/")) return;
    entries += 1;
    if (entries > MAX_ZIP_ENTRIES) {
      problem = "The document has too many entries.";
      throw STOP;
    }
    const chunks: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      total += chunk.length;
      if (total > MAX_DOCX_UNCOMPRESSED_BYTES) {
        problem = "The document is too large when unpacked.";
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
  if (problem) throw new Error(problem);
  return zipSync(files, { level: 0 });
}

/** Plain text of a file. Throws when it is damaged or over the safety limits. */
export async function readInline(bytes: Uint8Array, mime: string): Promise<string> {
  let text: string;
  if (mime === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      if (pdf.numPages > MAX_PDF_PAGES)
        throw new Error(`The PDF has more than ${MAX_PDF_PAGES} pages.`);
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

if (!isMainThread && workerData?.pathwiseRead && parentPort) {
  const port = parentPort;
  const { bytes, mime } = workerData as { bytes: Uint8Array; mime: string };
  readInline(bytes, mime).then(
    (text) => port.postMessage({ ok: true, text }),
    (e) => port.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
}
