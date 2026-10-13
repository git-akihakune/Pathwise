import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { makeDocx, makePdf } from "../../../../../test/fixtures/documents";
import { MAX_ZIP_ENTRIES, readDocumentText } from "./read";
import { DOCX_MIME } from "./sniff";

// A central directory whose ZIP64 end record claims 2^32 entries but holds none.
function entryCountBomb(): Buffer {
  const eocd = Buffer.alloc(56 + 20 + 22);
  eocd.writeUInt32LE(0x06064b50, 0);
  eocd.writeBigUInt64LE(44n, 4);
  eocd.writeBigUInt64LE(0xffffffffn, 24);
  eocd.writeBigUInt64LE(0xffffffffn, 32);
  eocd.writeUInt32LE(0x07064b50, 56);
  eocd.writeUInt32LE(0x06054b50, 76);
  eocd.writeUInt16LE(0xffff, 76 + 8);
  eocd.writeUInt16LE(0xffff, 76 + 10);
  eocd.writeUInt32LE(0xffffffff, 76 + 12);
  eocd.writeUInt32LE(0xffffffff, 76 + 16);
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), eocd]);
}

describe("readDocumentText", () => {
  it("reads DOCX, PDF and text", async () => {
    expect(await readDocumentText(makeDocx("Hello DOCX"), DOCX_MIME)).toContain("Hello DOCX");
    expect(await readDocumentText(makePdf("Hello PDF"), "application/pdf")).toContain("Hello PDF");
    expect(await readDocumentText(Buffer.from("﻿hi"), "text/plain")).toBe("hi");
  });

  it("rejects a DOCX with a huge declared uncompressed size", async () => {
    const bomb = Buffer.from(
      zipSync(
        { "word/document.xml": strToU8("x"), "pad.bin": new Uint8Array(60 * 1024 * 1024) },
        { level: 9 },
      ),
    );
    expect(bomb.length).toBeLessThan(200_000);
    const t = Date.now();
    await expect(readDocumentText(bomb, DOCX_MIME)).rejects.toThrow(/too large/i);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("rejects a DOCX with too many entries", async () => {
    const files: Record<string, Uint8Array> = { "word/document.xml": strToU8("x") };
    for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) files[`f${i}`] = new Uint8Array(0);
    await expect(readDocumentText(Buffer.from(zipSync(files)), DOCX_MIME)).rejects.toThrow(
      /entries/i,
    );
  });

  it("does not loop on a ZIP64 entry-count bomb", async () => {
    const t = Date.now();
    await expect(readDocumentText(entryCountBomb(), DOCX_MIME)).rejects.toThrow(
      /too many entries/i,
    );
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("rejects a PDF with too many pages", async () => {
    await expect(readDocumentText(makePdf("x", { pages: 101 }), "application/pdf")).rejects.toThrow(
      /pages/i,
    );
  });
});
