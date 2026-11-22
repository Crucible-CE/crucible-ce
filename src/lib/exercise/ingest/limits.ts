// Parser limits. Anything over a limit is refused with an IngestError, never
// silently cut.

export const INGEST_LIMITS = {
  /** Wall-clock budget for one PDF or DOCX parse in the worker. */
  timeoutMs: 20_000,
  /** Worker heap cap. */
  workerMaxOldGenerationMb: 256,
  workerMaxYoungGenerationMb: 32,
  pdfMaxPages: 300,
  /** Sum of declared uncompressed sizes inside a DOCX. */
  docxMaxUncompressedBytes: 50 * 1024 * 1024,
  docxMaxEntries: 5000,
  vttMaxCues: 20_000,
  vttMaxLineChars: 2_000,
  /** Extracted text cap (characters) for any format. */
  maxTextChars: 5_000_000,
} as const;

export type IngestErrorCode =
  | "timeout"
  | "too_large"
  | "too_many_pages"
  | "zip_bomb"
  | "malformed"
  | "unsupported"
  | "worker_failed";

const MESSAGES: Record<IngestErrorCode, string> = {
  timeout: "The file took too long to read. Try a smaller file.",
  too_large: "The file is too large to read. Try a smaller file.",
  too_many_pages: `The PDF has more than ${INGEST_LIMITS.pdfMaxPages} pages. Split it and upload the parts.`,
  zip_bomb: "The document expands to more than 50 MB. Save a smaller copy and upload again.",
  malformed: "The file could not be read. Check that it opens and upload it again.",
  unsupported: "This file type is not supported.",
  worker_failed: "The file could not be read. Try again.",
};

/** A parse failure with a code and a plain message safe to show users. */
export class IngestError extends Error {
  readonly code: IngestErrorCode;
  readonly userMessage: string;
  constructor(code: IngestErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "IngestError";
    this.code = code;
    this.userMessage = MESSAGES[code];
  }
}

export function assertTextWithinLimit(text: string): string {
  if (text.length > INGEST_LIMITS.maxTextChars) throw new IngestError("too_large", `${text.length} chars`);
  return text;
}
