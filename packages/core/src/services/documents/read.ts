import { execFile, fork } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ReadError, type ReadFailure } from "./read-worker";
import { DOCX_MIME, type DocumentMime } from "./sniff";

export {
  MAX_DOCX_UNCOMPRESSED_BYTES,
  MAX_PDF_PAGES,
  MAX_TEXT_CHARS,
  MAX_ZIP_ENTRIES,
  ReadError,
  type ReadFailure,
} from "./read-worker";

export const READ_TIMEOUT_MS = 30_000;
export const READ_RSS_CAP_BYTES = 512 * 1024 * 1024;
const CHILD_HEAP_MB = 256;

// Bundled, this file is dist/main.js and the child entry sits beside it as read-worker.js.
const CHILD_FILE = fileURLToPath(
  new URL(
    import.meta.url.endsWith(".ts") ? "./read-worker.ts" : "./read-worker.js",
    import.meta.url,
  ),
);

export interface ReadOptions {
  timeoutMs?: number;
  rssCapBytes?: number;
  /** Test hook: makes the child hang or crash instead of reading. */
  testMode?: "hang" | "crash";
}

/** Resident memory of another process in bytes, or null when it can't be read. */
async function rssOf(pid: number): Promise<number | null> {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const kb = /^VmRSS:\s+(\d+)\s+kB/m.exec(status)?.[1];
    if (kb) return Number(kb) * 1024;
  } catch {
    // not Linux, or the process is gone
  }
  return new Promise((resolve) => {
    execFile("ps", ["-o", "rss=", "-p", String(pid)], (err, out) => {
      const kb = err ? Number.NaN : Number.parseInt(out, 10);
      resolve(Number.isNaN(kb) ? null : kb * 1024);
    });
  });
}

function readInChild(bytes: Buffer, mime: string, o: ReadOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = fork(CHILD_FILE, [], {
      serialization: "advanced",
      execArgv: [...process.execArgv, `--max-old-space-size=${CHILD_HEAP_MB}`],
      env: {
        ...process.env,
        PATHWISE_READ_CHILD: "1",
        ...(o.testMode && { PATHWISE_READ_TEST: o.testMode }),
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let done = false;
    const finish = (err: ReadError | null, text?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      child.kill("SIGKILL");
      if (err) reject(err);
      else resolve(text ?? "");
    };
    const timer = setTimeout(
      () => finish(new ReadError("Reading the document timed out.", "timeout")),
      o.timeoutMs ?? READ_TIMEOUT_MS,
    );
    // Polled from outside: the child's event loop is blocked while it inflates.
    const cap = o.rssCapBytes ?? READ_RSS_CAP_BYTES;
    const watchdog = setInterval(() => {
      const pid = child.pid;
      if (pid === undefined) return;
      void rssOf(pid).then((rss) => {
        if (rss !== null && rss > cap)
          finish(new ReadError("Reading the document used too much memory.", "memory"));
      });
    }, 50);
    child.on("message", (m: { ok: boolean; text?: string; error?: string; code?: ReadFailure }) =>
      finish(
        m.ok ? null : new ReadError(m.error ?? "Unreadable document.", m.code ?? "unreadable"),
        m.text,
      ),
    );
    child.on("error", () => finish(new ReadError("The reader failed to start.", "crash")));
    child.on("exit", () =>
      finish(new ReadError("The reader process ended unexpectedly.", "crash")),
    );
    child.send({ bytes: new Uint8Array(bytes), mime });
  });
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Plain text of a stored file. PDFs and DOCX are parsed in a forked child process (heap limit, an
 * absolute RSS cap polled from here, a wall-clock timeout; killed on any breach), one at a time, so
 * a hostile file can fail one document but never the worker, and memory returns to the OS on exit.
 * Rejects with a ReadError carrying a fixed code.
 */
export function readDocumentText(
  bytes: Buffer,
  mime: DocumentMime,
  opts: ReadOptions = {},
): Promise<string> {
  if (mime === "text/plain")
    return Promise.resolve(bytes.toString("utf8").replace(/^﻿/, "").slice(0, 200_000));
  if (mime !== "application/pdf" && mime !== DOCX_MIME)
    return Promise.reject(new ReadError("Unsupported document type.", "unreadable"));
  const run = queue.then(() => readInChild(bytes, mime, opts));
  queue = run.catch(() => {});
  return run;
}
