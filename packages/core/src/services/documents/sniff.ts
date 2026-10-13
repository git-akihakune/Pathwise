import { unzipSync } from "fflate";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export type DocumentMime = "application/pdf" | typeof DOCX_MIME | "text/plain";

const MAX_ZIP_ENTRIES = 5000;
const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b);

/** Decides the type from the bytes alone; the client's filename and MIME are never consulted. */
export function sniffMime(bytes: Uint8Array): DocumentMime | null {
  if (bytes.length === 0) return null;
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  if (head.includes("%PDF-")) return "application/pdf";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // fflate trusts the entry count in the (possibly ZIP64) end record, so a tiny file can claim
    // 2^32 entries. Walk the entries lazily and stop at the first hit or after a small cap.
    const STOP = new Error("stop");
    let found = false;
    let seen = 0;
    try {
      unzipSync(bytes, {
        filter: (f) => {
          if (f.name === "word/document.xml") {
            found = true;
            throw STOP;
          }
          if (++seen > MAX_ZIP_ENTRIES) throw STOP;
          return false;
        },
      });
    } catch (err) {
      if (err !== STOP) return null;
    }
    return found ? DOCX_MIME : null;
  }
  if (bytes.includes(0)) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "text/plain";
  } catch {
    return null;
  }
}
