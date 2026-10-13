import { deflateSync } from "node:zlib";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { makeDocx, makePdf } from "../../../../../test/fixtures/documents";
import { MAX_ZIP_ENTRIES, type ReadError, readDocumentText } from "./read";
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
    await expect(readDocumentText(entryCountBomb(), DOCX_MIME)).rejects.toThrow();
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("rejects a PDF with too many pages", async () => {
    await expect(readDocumentText(makePdf("x", { pages: 101 }), "application/pdf")).rejects.toThrow(
      /pages/i,
    );
  });
});

describe("hostile files (child process isolation)", () => {
  const rss = () => Math.round(process.memoryUsage().rss / 1048576);
  const lyingDocx = () => {
    const big = new Uint8Array(120 * 1024 * 1024).fill(0x20);
    const z = Buffer.from(zipSync({ "word/document.xml": big }, { level: 9 }));
    const name = Buffer.from("word/document.xml");
    for (let i = 0; i < z.length - 4; i++) {
      const sig = z.readUInt32LE(i);
      if (sig === 0x04034b50 && z.subarray(i + 30, i + 30 + name.length).equals(name))
        z.writeUInt32LE(1000, i + 22);
      if (sig === 0x02014b50 && z.subarray(i + 46, i + 46 + name.length).equals(name))
        z.writeUInt32LE(1000, i + 24);
    }
    return z;
  };
  const pdfBomb = (mb: number) => {
    const comp = deflateSync(Buffer.alloc(mb * 1024 * 1024, 0x20), { level: 9 });
    return Buffer.from(
      makePdf("x")
        .toString("latin1")
        .replace(
          /<< \/Length \d+ >>\nstream\n[\s\S]*?\nendstream/,
          () =>
            `<< /Length ${comp.length} /Filter /FlateDecode >>\nstream\n${comp.toString("latin1")}\nendstream`,
        ),
      "latin1",
    );
  };
  const code = (p: Promise<unknown>) =>
    p.then(
      () => "ok",
      (e: ReadError) => e.code,
    );

  it("rejects a DOCX whose real content inflates far beyond its declared sizes", async () => {
    const z = lyingDocx();
    expect(z.length).toBeLessThan(500_000);
    const t = Date.now();
    expect(await code(readDocumentText(z, DOCX_MIME))).toBe("too_large");
    expect(Date.now() - t).toBeLessThan(10_000);
  });

  it("kills a reader that exceeds the RSS cap", async () => {
    const t = Date.now();
    expect(
      await code(
        readDocumentText(pdfBomb(300), "application/pdf", { rssCapBytes: 200 * 1024 * 1024 }),
      ),
    ).toBe("memory");
    console.info(`memory kill: ${Date.now() - t} ms`);
  }, 60_000);

  it("kills a hung reader at the timeout", async () => {
    const t = Date.now();
    expect(
      await code(
        readDocumentText(makePdf("x"), "application/pdf", { timeoutMs: 500, testMode: "hang" }),
      ),
    ).toBe("timeout");
    expect(Date.now() - t).toBeLessThan(5000);
  });

  it("reports a crashing reader", async () => {
    expect(
      await code(readDocumentText(makePdf("x"), "application/pdf", { testMode: "crash" })),
    ).toBe("crash");
  });

  it("keeps the parent's memory bounded across back-to-back bombs, then reads normally", async () => {
    const bomb = pdfBomb(300);
    const before = rss();
    const results: string[] = [];
    for (let i = 0; i < 2; i++)
      results.push(
        await code(readDocumentText(bomb, "application/pdf", { rssCapBytes: 200 * 1024 * 1024 })),
      );
    const after = rss();
    console.info(`back-to-back: ${results} parent rss ${before} -> ${after} MB`);
    expect(results).toEqual(["memory", "memory"]);
    expect(after - before).toBeLessThan(250);
    expect(await readDocumentText(makePdf("Still fine"), "application/pdf")).toContain(
      "Still fine",
    );
  }, 90_000);
});
