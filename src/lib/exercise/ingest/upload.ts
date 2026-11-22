// Bounded multipart upload reader with per-kind limits and content sniffing.
//
//   - A declared Content-Length over the cap is refused before a byte is read.
//   - The body is read chunk by chunk and abandoned the moment it passes the
//     cap (covers chunked bodies with no Content-Length).
//   - The file type comes from the bytes, never the client:
//       PDF   starts with %PDF-
//       DOCX  a zip with word/document.xml and no macro parts
//             (vbaProject.bin, macroEnabled content types, .docm/.dotm)
//       VTT   starts with WEBVTT
//       text  valid UTF-8 with no NUL (txt, or md by file extension)
//
//   const up = await readUpload(req, "document");
//   if (!up.ok) return up.response;
//   up.file.bytes, up.detected.format, up.detected.mime

import { NextResponse } from "next/server";
import { isZip, listZipEntries, readZipEntry } from "@/lib/exercise/ingest/zip";

export type UploadKind = "document";
export type DetectedFormat = "pdf" | "docx" | "vtt" | "txt" | "md";

export const UPLOAD_LIMITS: Record<UploadKind, number> = {
  document: 10 * 1024 * 1024,
};

const ALLOWED_FORMATS: Record<UploadKind, DetectedFormat[]> = {
  document: ["pdf", "docx", "txt", "md"],
};

export const FORMAT_MIME: Record<DetectedFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  vtt: "text/vtt",
  txt: "text/plain",
  md: "text/markdown",
};

/** Multipart boundaries, part headers, and the small text fields. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_PARTS = 16;
const MAX_PART_HEADER_BYTES = 8 * 1024;

function json(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

function tooLarge(maxBytes: number): NextResponse {
  const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
  return json(413, `The file is over the ${mb} MB limit. Upload a smaller file.`);
}

// ---------------------------------------------------------------------------
// Multipart parsing (zero-copy file parts).
// ---------------------------------------------------------------------------

/** One uploaded file. `bytes` is a view into the request body buffer. */
export class UploadedFile {
  constructor(
    readonly name: string,
    readonly type: string,
    readonly bytes: Buffer,
  ) {}
  get size(): number {
    return this.bytes.length;
  }
}

export type FormValue = string | UploadedFile;

export class ParsedForm {
  constructor(private readonly parts: [string, FormValue][]) {}
  get(name: string): FormValue | null {
    return this.parts.find(([k]) => k === name)?.[1] ?? null;
  }
  getString(name: string): string | null {
    const v = this.get(name);
    return typeof v === "string" ? v : null;
  }
  getFile(name: string): UploadedFile | null {
    const v = this.get(name);
    return v instanceof UploadedFile ? v : null;
  }
  entries(): IterableIterator<[string, FormValue]> {
    return this.parts[Symbol.iterator]();
  }
}

function boundaryOf(contentType: string): string | null {
  const m = /;\s*boundary=(?:"([^"]{1,70})"|([^\s;]{1,70}))/i.exec(contentType);
  return m ? (m[1] ?? m[2]) : null;
}

function parseDisposition(value: string): { type: string; params: Record<string, string> } {
  const semi = value.indexOf(";");
  const type = (semi < 0 ? value : value.slice(0, semi)).trim().toLowerCase();
  const params: Record<string, string> = {};
  const re = /;\s*([^\s=;]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g;
  let m: RegExpExecArray | null;
  const rest = semi < 0 ? "" : value.slice(semi);
  while ((m = re.exec(rest))) {
    params[m[1].toLowerCase()] = m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : m[3].trim();
  }
  return { type, params };
}

function decodeFormName(s: string): string {
  return s.replace(/%22/g, '"').replace(/%0D/gi, "\r").replace(/%0A/gi, "\n");
}

function decodeExtValue(v: string): string | null {
  const m = /^([^']*)'[^']*'(.*)$/.exec(v);
  if (!m || (m[1] && m[1].toLowerCase() !== "utf-8")) return null;
  try {
    return decodeURIComponent(m[2]);
  } catch {
    return null;
  }
}

const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");

/** Parse a multipart/form-data body. Null when malformed. */
export function parseMultipart(body: Buffer, contentType: string): ParsedForm | null {
  const boundary = boundaryOf(contentType);
  if (!boundary) return null;
  const delim = Buffer.from(`--${boundary}`);
  const sep = Buffer.concat([CRLF, delim]);

  let pos = body.subarray(0, delim.length).equals(delim) ? 0 : body.indexOf(sep);
  if (pos < 0) return null;
  if (pos > 0) pos += CRLF.length;

  const parts: [string, FormValue][] = [];
  for (;;) {
    let cur = pos + delim.length;
    if (body[cur] === 0x2d && body[cur + 1] === 0x2d) break;
    while (body[cur] === 0x20 || body[cur] === 0x09) cur++;
    if (body[cur] !== 0x0d || body[cur + 1] !== 0x0a) return null;
    const headersStart = cur + 2;
    const headersEnd = body.indexOf(HEADER_END, headersStart);
    if (headersEnd < 0 || headersEnd - headersStart > MAX_PART_HEADER_BYTES) return null;
    const next = body.indexOf(sep, headersEnd + HEADER_END.length);
    if (next < 0) return null;
    if (parts.length >= MAX_PARTS) return null;

    let disposition: ReturnType<typeof parseDisposition> | null = null;
    let partType = "";
    for (const line of body.subarray(headersStart, headersEnd).toString("utf8").split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const name = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (name === "content-disposition") disposition = parseDisposition(value);
      else if (name === "content-type") partType = value;
    }
    if (!disposition || disposition.type !== "form-data" || disposition.params.name === undefined) return null;

    const fieldName = decodeFormName(disposition.params.name);
    const content = body.subarray(headersEnd + HEADER_END.length, next);
    const p = disposition.params;
    if (p.filename !== undefined || p["filename*"] !== undefined) {
      const filename =
        (p["filename*"] !== undefined ? decodeExtValue(p["filename*"]) : null) ?? decodeFormName(p.filename ?? "");
      parts.push([fieldName, new UploadedFile(filename, partType || "application/octet-stream", content)]);
    } else {
      parts.push([fieldName, content.toString("utf8")]);
    }
    pos = next + CRLF.length;
  }
  return new ParsedForm(parts);
}

// ---------------------------------------------------------------------------
// Bounded reader
// ---------------------------------------------------------------------------

export type BoundedFormResult = { ok: true; form: ParsedForm } | { ok: false; response: NextResponse };

/** Read a multipart body without holding more than `maxFileBytes` (+ framing) in memory. */
export async function readBoundedMultipart(req: Request, maxFileBytes: number): Promise<BoundedFormResult> {
  const limit = maxFileBytes + MULTIPART_OVERHEAD_BYTES;
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return { ok: false, response: json(400, "Send the file as multipart/form-data.") };
  }
  const declaredRaw = req.headers.get("content-length");
  const declared = declaredRaw === null ? NaN : Number(declaredRaw);
  // Refuse on the declared length before reading any of the body.
  if (Number.isFinite(declared) && declared > limit) {
    await req.body?.cancel().catch(() => {});
    return { ok: false, response: tooLarge(maxFileBytes) };
  }
  if (!req.body) return { ok: false, response: json(400, "No file was sent.") };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return { ok: false, response: tooLarge(maxFileBytes) };
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks, total);

  const form = parseMultipart(body, contentType);
  if (!form) return { ok: false, response: json(400, "The upload was malformed. Try again.") };
  for (const [key, value] of form.entries()) {
    const text = typeof value === "string" ? value : value.name;
    if (key.includes("\u0000") || text.includes("\u0000")) {
      return { ok: false, response: json(400, "Text must not contain NUL characters.") };
    }
  }
  return { ok: true, form };
}

// ---------------------------------------------------------------------------
// Sniffing
// ---------------------------------------------------------------------------

export type SniffResult = { ok: true; format: DetectedFormat; mime: string } | { ok: false; error: string };

const MACRO_CONTENT_TYPES = [
  "application/vnd.ms-word.document.macroenabled",
  "application/vnd.ms-word.template.macroenabled",
  "application/vnd.ms-word.vbaproject",
  "application/vnd.ms-office.vbaproject",
];

function startsWithAscii(buf: Uint8Array, text: string, offset = 0): boolean {
  if (buf.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) if (buf[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

function hasUtf8Bom(buf: Uint8Array): boolean {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

/** Is this a DOCX without macros? Returns an error string when not. */
export function checkDocx(buf: Uint8Array): string | null {
  const entries = listZipEntries(buf);
  if (!entries) return "The file is not a valid Word document.";
  const names = new Set(entries.map((e) => e.name));
  if (!names.has("word/document.xml")) return "The file is not a Word document.";
  if (entries.some((e) => /(^|\/)vbaProject\.bin$/i.test(e.name) || /(^|\/)vbaData\.xml$/i.test(e.name))) {
    return "Documents with macros are not accepted. Save it as .docx and upload again.";
  }
  const ct = entries.find((e) => e.name === "[Content_Types].xml");
  if (!ct) return "The file is not a valid Word document.";
  const xml = readZipEntry(buf, ct, 1024 * 1024);
  if (!xml) return "The file is not a valid Word document.";
  const lower = xml.toString("utf8").toLowerCase();
  if (MACRO_CONTENT_TYPES.some((t) => lower.includes(t))) {
    return "Documents with macros are not accepted. Save it as .docx and upload again.";
  }
  return null;
}

/** Valid UTF-8 with no NUL. */
export function isUtf8Text(buf: Uint8Array): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** Decide the real format from the bytes. The client's name and type are only used to refuse macro formats and pick md over txt. */
export function sniffUpload(bytes: Uint8Array, kind: UploadKind, claimedName = "", claimedType = ""): SniffResult {
  const allowed = ALLOWED_FORMATS[kind];
  const ext = extensionOf(claimedName);
  if (["docm", "dotm", "xlsm", "pptm"].includes(ext) || claimedType.toLowerCase().includes("macroenabled")) {
    return { ok: false, error: "Documents with macros are not accepted. Save it as .docx and upload again." };
  }
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };

  let format: DetectedFormat | null = null;
  if (startsWithAscii(bytes, "%PDF-")) {
    format = "pdf";
  } else if (isZip(bytes)) {
    const err = checkDocx(bytes);
    if (err) return { ok: false, error: err };
    format = "docx";
  } else if (startsWithAscii(bytes, "WEBVTT") || (hasUtf8Bom(bytes) && startsWithAscii(bytes, "WEBVTT", 3))) {
    format = isUtf8Text(bytes) ? "vtt" : null;
  } else if (isUtf8Text(bytes)) {
    format = ext === "md" || ext === "markdown" ? "md" : "txt";
  }

  if (!format) return { ok: false, error: "This file type is not supported." };
  if (!allowed.includes(format)) {
    // A VTT uploaded as a document is still useful text.
    if (kind === "document" && format === "vtt") return { ok: true, format: "txt", mime: FORMAT_MIME.txt };
    return { ok: false, error: "This file type is not supported here." };
  }
  return { ok: true, format, mime: FORMAT_MIME[format] };
}

export type UploadResult =
  | { ok: true; file: UploadedFile; form: ParsedForm; detected: { format: DetectedFormat; mime: string } }
  | { ok: false; response: NextResponse };

/** Read one file field (default "file") for an upload kind, size-capped and sniffed. */
export async function readUpload(req: Request, kind: UploadKind, field = "file"): Promise<UploadResult> {
  const max = UPLOAD_LIMITS[kind];
  const read = await readBoundedMultipart(req, max);
  if (!read.ok) return read;
  const file = read.form.getFile(field);
  if (!file) return { ok: false, response: json(400, "No file was sent.") };
  if (file.size > max) return { ok: false, response: tooLarge(max) };
  const sniff = sniffUpload(file.bytes, kind, file.name, file.type);
  if (!sniff.ok) return { ok: false, response: json(415, sniff.error) };
  return { ok: true, file, form: read.form, detected: { format: sniff.format, mime: sniff.mime } };
}
