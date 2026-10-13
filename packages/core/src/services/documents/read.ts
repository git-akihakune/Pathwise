import { Worker } from "node:worker_threads";
import { DOCX_MIME, type DocumentMime } from "./sniff";

export {
  MAX_DOCX_UNCOMPRESSED_BYTES,
  MAX_PDF_PAGES,
  MAX_TEXT_CHARS,
  MAX_ZIP_ENTRIES,
} from "./read-worker";

export const READ_TIMEOUT_MS = 30_000;
const MAX_HEAP_MB = 384;
/** Off-heap buffers (inflated streams) are not covered by the heap limit, so watch the process too. */
const MAX_RSS_GROWTH = 1024 * 1024 * 1024;

// Bundled, this file is dist/main.js and the worker entry sits beside it as read-worker.js.
const WORKER_FILE = new URL(
  import.meta.url.endsWith(".ts") ? "./read-worker.ts" : "./read-worker.js",
  import.meta.url,
);

/**
 * Plain text of a stored file, parsed in a worker thread with a heap limit, a wall-clock timeout
 * and an RSS watchdog, so a hostile PDF or DOCX can fail one document but never the process.
 * Rejects when the file is damaged, over the safety limits, or the thread dies.
 */
export function readDocumentText(bytes: Buffer, mime: DocumentMime): Promise<string> {
  const known = mime === "application/pdf" || mime === DOCX_MIME || mime === "text/plain";
  if (!known) return Promise.reject(new Error("Unsupported document type."));
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_FILE, {
      workerData: { pathwiseRead: true, bytes: new Uint8Array(bytes), mime },
      resourceLimits: { maxOldGenerationSizeMb: MAX_HEAP_MB, maxYoungGenerationSizeMb: 64 },
    });
    const baseline = process.memoryUsage.rss();
    let done = false;
    const finish = (err: Error | null, text?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      void worker.terminate();
      if (err) reject(err);
      else resolve(text ?? "");
    };
    const timer = setTimeout(
      () => finish(new Error("Reading the document timed out.")),
      READ_TIMEOUT_MS,
    );
    const watchdog = setInterval(() => {
      if (process.memoryUsage.rss() - baseline > MAX_RSS_GROWTH)
        finish(new Error("Reading the document used too much memory."));
    }, 50);
    worker.on("message", (m: { ok: boolean; text?: string; error?: string }) =>
      finish(m.ok ? null : new Error(m.error ?? "Unreadable document."), m.text),
    );
    worker.on("error", (e) => finish(e));
    worker.on("exit", (code) => finish(new Error(`Reader exited with code ${code}.`)));
  });
}
