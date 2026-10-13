import { unzipSync } from "fflate";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export type DocumentMime = "application/pdf" | typeof DOCX_MIME | "text/plain";

const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b);

/** Decides the type from the bytes alone; the client's filename and MIME are never consulted. */
export function sniffMime(bytes: Uint8Array): DocumentMime | null {
  if (bytes.length === 0) return null;
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  if (head.includes("%PDF-")) return "application/pdf";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const names: string[] = [];
    try {
      // The filter lists entries without inflating any of them.
      unzipSync(bytes, {
        filter: (f) => {
          names.push(f.name);
          return false;
        },
      });
    } catch {
      return null;
    }
    return names.includes("word/document.xml") ? DOCX_MIME : null;
  }
  if (bytes.includes(0)) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "text/plain";
  } catch {
    return null;
  }
}
