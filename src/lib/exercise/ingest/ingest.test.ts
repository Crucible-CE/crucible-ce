// @vitest-environment node
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { makeDocx, makePdf, makeZipBomb } from "@/test/fixtures";
import { extractPdfText } from "./pdf";
import { checkDocxArchive, extractDocxText, inflateAllBounded } from "./docx";
import { IngestError } from "./limits";
import { declaredUncompressedTotal, listZipEntries } from "./zip";

const MB = 1024 * 1024;

/**
 * A DOCX-shaped zip whose headers lie: every entry's declared uncompressed
 * size (central directory and local header) is patched down to 1 KB.
 */
async function makeLyingZip(parts: number[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  zip.file("word/document.xml", new Uint8Array(parts[0]));
  parts.slice(1).forEach((n, i) => zip.file(`word/media/part${i}.bin`, new Uint8Array(n)));
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  for (let i = 0; i + 4 <= buf.length; i++) {
    const sig = buf.readUInt32LE(i);
    if (sig === 0x02014b50 && buf.readUInt32LE(i + 24) > 1024) buf.writeUInt32LE(1024, i + 24);
    else if (sig === 0x04034b50 && buf.readUInt32LE(i + 22) > 1024) buf.writeUInt32LE(1024, i + 22);
  }
  return buf;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof IngestError ? e.code : `other:${String(e)}`;
  }
}

describe("PDF (worker)", () => {
  it("extracts text page by page", async () => {
    const r = await extractPdfText(makePdf(["Incident response plan", "Escalation contacts"]));
    expect(r.pages).toBe(2);
    expect(r.text).toContain("Incident response plan");
    expect(r.text).toContain("Escalation contacts");
  });

  it("refuses more pages than the cap", async () => {
    expect(await code(extractPdfText(makePdf(["a", "b", "c"]), { maxPages: 2 }))).toBe("too_many_pages");
  });

  it("refuses non-PDF bytes and malformed PDFs", async () => {
    expect(await code(extractPdfText(Buffer.from("hello")))).toBe("unsupported");
    expect(await code(extractPdfText(Buffer.from("%PDF-1.4\ngarbage that is not a pdf")))).toBe("malformed");
  });

  it("survives many worker start/teardown cycles (native canvas addon is blocked)", async () => {
    for (let i = 0; i < 12; i++) expect((await extractPdfText(makePdf([`p${i}`]))).pages).toBe(1);
  });

  it("times out", async () => {
    expect(await code(extractPdfText(makePdf(["slow"]), { timeoutMs: 1 }))).toBe("timeout");
  });
});

describe("DOCX (jszip size check, then mammoth in the worker)", () => {
  it("extracts raw text", async () => {
    const text = await extractDocxText(await makeDocx(["First paragraph.", "Second paragraph."]));
    expect(text).toContain("First paragraph.");
    expect(text).toContain("Second paragraph.");
  });

  it("refuses a zip bomb from its declared sizes, before inflating", async () => {
    const bomb = await makeZipBomb(60 * 1024 * 1024);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const entries = listZipEntries(bomb)!;
    expect(declaredUncompressedTotal(entries)).toBeGreaterThan(50 * 1024 * 1024);
    expect(await code(checkDocxArchive(bomb))).toBe("zip_bomb");
    expect(await code(extractDocxText(bomb))).toBe("zip_bomb");
  });

  it("refuses an archive whose headers understate its sizes, by inflating with a cap", async () => {
    const liar = await makeLyingZip([60 * MB]);
    expect(declaredUncompressedTotal(listZipEntries(liar)!)).toBeLessThan(MB);
    expect(await code(checkDocxArchive(liar))).toBe("zip_bomb");
    expect(await code(extractDocxText(liar))).toBe("zip_bomb");
  });

  it("counts the running total across entries, not each entry alone", async () => {
    const liar = await makeLyingZip([20 * MB, 20 * MB, 20 * MB]);
    expect(await code(checkDocxArchive(liar))).toBe("zip_bomb");
    const ok = await makeLyingZip([10 * MB, 10 * MB]);
    expect(inflateAllBounded(ok).total).toBeGreaterThan(20 * MB - 1);
  });

  it("refuses broken archives", async () => {
    expect(await code(extractDocxText(Buffer.from("PK\u0003\u0004 not really a zip")))).toBe("malformed");
  });
});
