import { strToU8, zipSync } from "fflate";
import { expect, it } from "vitest";
import { makeDocx, makePdf } from "../../../../../test/fixtures/documents";
import { DOCX_MIME, sniffMime } from "./sniff";

it.each([
  ["a PDF", makePdf("Jane Doe"), "application/pdf"],
  [
    "a PDF after a short preamble",
    Buffer.concat([Buffer.from("\r\n\r\n"), makePdf("x")]),
    "application/pdf",
  ],
  ["a DOCX", makeDocx("Jane Doe"), DOCX_MIME],
  ["UTF-8 text with a BOM", Buffer.from("﻿Jane Doe — Zoë's nurse CV", "utf8"), "text/plain"],
  ["a zip that is not a DOCX", Buffer.from(zipSync({ "a.txt": strToU8("x") })), null],
  ["a PNG renamed .pdf", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), null],
  ["a Windows executable", Buffer.from("MZ\x90\x00\x03\x00", "latin1"), null],
  ["a legacy .doc", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), null],
  ["Latin-1 text that is not UTF-8", Buffer.from([0x4a, 0xe9, 0x72, 0xf4, 0x6d, 0x65]), null],
  ["text containing NUL bytes", Buffer.from("abc\u0000def", "utf8"), null],
  ["an empty file", Buffer.alloc(0), null],
])("%s → %s (Review Focus 3)", (_name, bytes, expected) => {
  expect(sniffMime(bytes)).toBe(expected);
});
