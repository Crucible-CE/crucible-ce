// PDF to plain text, parsed in the resource-limited worker (pdfjs-dist).
import { INGEST_LIMITS, IngestError, assertTextWithinLimit } from "./limits";
import { runIngestWorker } from "./worker";

export interface PdfText {
  text: string;
  pages: number;
}

export async function extractPdfText(bytes: Uint8Array, opts: { timeoutMs?: number; maxPages?: number } = {}): Promise<PdfText> {
  if (bytes.byteLength < 5 || Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") {
    throw new IngestError("unsupported", "not a PDF");
  }
  const res = await runIngestWorker("pdf", bytes, { timeoutMs: opts.timeoutMs, maxPages: opts.maxPages ?? INGEST_LIMITS.pdfMaxPages });
  return { text: assertTextWithinLimit(normalizeExtractedText(res.text)), pages: res.pages ?? 0 };
}

/** Line endings to \n, no trailing spaces, at most two blank lines in a row. */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
