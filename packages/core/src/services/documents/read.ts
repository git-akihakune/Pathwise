import { unzipSync } from "fflate";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { DOCX_MIME, type DocumentMime } from "./sniff";

export const MAX_ZIP_ENTRIES = 2000;
export const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_PAGES = 100;
/** Stored extracted text is cut here, however much the file holds. */
export const MAX_TEXT_CHARS = 200_000;

/** Throws for an archive whose entry count or declared sizes exceed the limits, before mammoth (JSZip) sees it. */
function assertSafeDocx(bytes: Uint8Array): void {
  const STOP = new Error("stop");
  let entries = 0;
  let declared = 0;
  let problem: string | null = null;
  try {
    unzipSync(bytes, {
      filter: (f) => {
        entries += 1;
        declared += f.originalSize;
        if (entries > MAX_ZIP_ENTRIES) problem = "The document has too many entries.";
        else if (declared > MAX_DOCX_UNCOMPRESSED_BYTES)
          problem = "The document is too large when unpacked.";
        if (problem) throw STOP;
        return false;
      },
    });
  } catch (err) {
    if (err !== STOP) throw err;
  }
  if (problem) throw new Error(problem);
}

/** Plain text of a stored file. Throws when the file is damaged or over the safety limits. */
export async function readDocumentText(bytes: Buffer, mime: DocumentMime): Promise<string> {
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
    assertSafeDocx(bytes);
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else {
    text = bytes.toString("utf8").replace(/^﻿/, "");
  }
  return text.slice(0, MAX_TEXT_CHARS);
}
