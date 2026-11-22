// Test fixtures generated in code (no binary files in the repo).
import JSZip from "jszip";
import { Document, Packer, Paragraph } from "docx";

/** A valid PDF with one page per string (Helvetica text). */
export function makePdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  const fontId = 3 + pages.length * 2;
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  pages.forEach((text, i) => {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const safe = text.replace(/([()\\])/g, "\\$1");
    const stream = `BT /F1 18 Tf 72 720 Td (${safe}) Tj ET`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A real DOCX with one paragraph per string. */
export async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: paragraphs.map((p) => new Paragraph(p)) }] });
  return Packer.toBuffer(doc);
}

/** A DOCX-shaped zip whose document.xml inflates to `bytes` of zeros (compresses to a few KB). */
export async function makeZipBomb(bytes = 60 * 1024 * 1024): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  );
  zip.file("word/document.xml", new Uint8Array(bytes));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

/** A zip that looks like a macro-enabled document. */
export async function makeDocm(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
  );
  zip.file("word/document.xml", "<w:document/>");
  zip.file("word/vbaProject.bin", new Uint8Array([1, 2, 3]));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
