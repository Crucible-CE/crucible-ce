// DOCX to plain text.
//
//   1. JSZip reads the central directory (no inflation) and the declared
//      uncompressed sizes are summed. Over 50 MB, or too many entries: refused
//      before anything is decompressed.
//   2. Every entry is inflated with a hard zlib output cap against a running
//      50 MB total. Declared sizes are never trusted, so an archive whose
//      headers understate its sizes is refused here, before mammoth.
//   3. mammoth extracts raw text in the resource-limited worker.

import JSZip from "jszip";
import { INGEST_LIMITS, IngestError, assertTextWithinLimit } from "./limits";
import { runIngestWorker } from "./worker";
import { normalizeExtractedText } from "./pdf";
import { inflateZipEntry, listZipEntries } from "./zip";

type JSZipInternal = { _data?: { uncompressedSize?: number } };

/**
 * Inflate every entry against a running total of `limit` bytes. Returns the
 * actual uncompressed total and the number of entries. Throws IngestError
 * zip_bomb on overflow, malformed when an entry cannot be read.
 */
export function inflateAllBounded(bytes: Uint8Array, limit: number = INGEST_LIMITS.docxMaxUncompressedBytes): { total: number; count: number } {
  const entries = listZipEntries(bytes);
  if (!entries) throw new IngestError("malformed", "central directory");
  if (entries.length > INGEST_LIMITS.docxMaxEntries) throw new IngestError("zip_bomb", `${entries.length} entries`);
  let total = 0;
  for (const e of entries) {
    const r = inflateZipEntry(bytes, e, limit - total);
    if (!r.ok) {
      if (r.reason === "over_limit") throw new IngestError("zip_bomb", `over ${limit} bytes inflated`);
      throw new IngestError("malformed", `cannot read ${e.name}`);
    }
    total += r.data.length;
    if (total > limit) throw new IngestError("zip_bomb", `${total} bytes inflated`);
  }
  return { total, count: entries.length };
}

/** Size checks. Throws IngestError for a bomb or a broken archive. */
export async function checkDocxArchive(bytes: Uint8Array): Promise<{ entries: number; uncompressedBytes: number }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  } catch (err) {
    throw new IngestError("malformed", err instanceof Error ? err.message : String(err));
  }
  const files = Object.values(zip.files);
  if (files.length > INGEST_LIMITS.docxMaxEntries) throw new IngestError("zip_bomb", `${files.length} entries`);
  let declared = 0;
  for (const f of files) {
    if (f.dir) continue;
    const size = (f as unknown as JSZipInternal)._data?.uncompressedSize;
    // Unknown size: fail closed.
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0) throw new IngestError("malformed", `no size for ${f.name}`);
    declared += size;
    if (declared > INGEST_LIMITS.docxMaxUncompressedBytes) throw new IngestError("zip_bomb", `${declared} bytes declared`);
  }
  if (!zip.file("word/document.xml")) throw new IngestError("unsupported", "no word/document.xml");

  // The declared sizes may lie. Inflate everything with a hard cap.
  const { total, count } = inflateAllBounded(bytes);
  // mammoth reads the archive through JSZip: it must not see more entries than were measured.
  if (files.filter((f) => !f.dir).length > count) throw new IngestError("malformed", "entry count mismatch");
  return { entries: files.length, uncompressedBytes: total };
}

/** DOCX to text. Used for source documents. */
export async function extractDocxText(bytes: Uint8Array, opts: { timeoutMs?: number } = {}): Promise<string> {
  await checkDocxArchive(bytes);
  const res = await runIngestWorker("docx", bytes, { timeoutMs: opts.timeoutMs });
  return assertTextWithinLimit(normalizeExtractedText(res.text));
}
