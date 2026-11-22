// Shared file-response helper — the ONE place API routes build a response that
// carries file bytes (uploaded evidence/attachments AND server-generated
// exports).
//
// Why: uploaded files are attacker-controlled. Serving a client-declared type
// (e.g. text/html, image/svg+xml) with `Content-Disposition: inline` from our
// origin is stored XSS — and because the app CSP allows `script-src 'self'`, one
// uploaded file could even be loaded as a <script> by another. So:
//   - inline only for a small allowlist of passive types (raster images,
//     plain text) — never HTML/SVG/JS/XML, and never PDF;
//   - anything else is forced to `application/octet-stream` + attachment;
//   - every file response carries `X-Content-Type-Options: nosniff` and a
//     sandboxing CSP (no script, no same-origin) so even a mis-typed file can't
//     execute in our origin;
//   - the filename is sanitized and sent as an ASCII fallback plus RFC 5987
//     `filename*` (UTF-8), so it can't break out of the header.
// At upload time, {@link safeStoredMimeType} derives the stored type from the
// file's magic bytes rather than trusting the client.

import { NextResponse } from "next/server";

/** Types that may render inline in the browser (passive content only). */
export const INLINE_SAFE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
]);
// application/pdf is deliberately NOT inline: browser PDF viewers (pdf.js in
// Firefox runs with elevated privileges; Chromium won't render under a sandbox
// CSP) make inline PDF a risk/compat trap — PDFs are always downloaded.

export const FILE_RESPONSE_CSP = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

const OCTET = "application/octet-stream";

/** Lower-case the media type and drop parameters ("Text/Plain; charset=x" → "text/plain"). */
export function normalizeMimeType(mime: string | null | undefined): string {
  if (!mime) return "";
  return mime.split(";")[0]!.trim().toLowerCase();
}

export function isInlineSafeMimeType(mime: string | null | undefined): boolean {
  return INLINE_SAFE_MIME_TYPES.has(normalizeMimeType(mime));
}

/**
 * Strip anything that could break or abuse a Content-Disposition header or a
 * save dialog: control chars (incl. CR/LF), quotes, backslashes, path
 * separators, and leading dots. Falls back to "download".
 */
export function sanitizeFilename(name: string | null | undefined, fallback = "download"): string {
  const cleaned = (name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/["\\/:*?<>|]/g, "_")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 200);
  return cleaned || fallback;
}

/** RFC 5987 ext-value encoding (percent-encode everything outside attr-char). */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `inline|attachment; filename="ascii"; filename*=UTF-8''utf8` */
export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const safe = sanitizeFilename(filename);
  // ASCII fallback for old clients: replace non-printable-ASCII with "_".
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/%/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(safe)}`;
}

export interface FileResponseOptions {
  filename: string;
  /** The stored / generated content type. */
  contentType: string | null | undefined;
  /** Caller asked for an in-browser preview (e.g. ?inline=1). Honored only for allowlisted types. */
  inline?: boolean;
  /**
   * Server-generated content (CSV/ZIP/DOCX/ICS/JSON we built ourselves): keep
   * the given Content-Type even when it isn't inline-safe — it is still always
   * served as an attachment with nosniff + sandbox CSP. Never set this for
   * user-uploaded bytes.
   */
  trustedContentType?: boolean;
  /** Extra headers (integrity, cache, etc.). Cannot override the security headers. */
  headers?: Record<string, string>;
  status?: number;
}

/** Pure header computation (unit tested). */
export function fileResponseHeaders(opts: FileResponseOptions & { contentLength?: number }): Record<string, string> {
  const mime = normalizeMimeType(opts.contentType);
  const inlineSafe = isInlineSafeMimeType(mime);
  const inline = !!opts.inline && inlineSafe;

  let contentType: string;
  if (inlineSafe) {
    // text/plain: pin the charset so the browser can't be talked into UTF-7 etc.
    contentType = mime === "text/plain" ? "text/plain; charset=utf-8" : mime;
  } else if (opts.trustedContentType && opts.contentType) {
    contentType = opts.contentType;
  } else {
    contentType = OCTET;
  }

  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    ...(opts.headers ?? {}),
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", opts.filename),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": FILE_RESPONSE_CSP,
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (opts.contentLength != null) headers["Content-Length"] = String(opts.contentLength);
  return headers;
}

/** Build the response. `body` may be bytes or a string (generated text exports). */
export function fileResponse(body: Uint8Array | Buffer | string, opts: FileResponseOptions): NextResponse {
  const payload: BodyInit = typeof body === "string" ? body : new Uint8Array(body);
  const contentLength = typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
  return new NextResponse(payload, {
    status: opts.status ?? 200,
    headers: fileResponseHeaders({ ...opts, contentLength }),
  });
}

// ---------------------------------------------------------------------------
// Upload-side: never trust the client-declared type.
// ---------------------------------------------------------------------------

function startsWith(buf: Uint8Array, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[offset + i] !== sig[i]) return false;
  return true;
}

/** Sniff the allowlisted binary types from magic bytes. Returns null if none match. */
export function sniffMimeType(buf: Uint8Array): string | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(buf, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return "image/gif";
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  return null;
}

/**
 * Plain text: the client SAID text/plain and the bytes look like text (no NUL
 * in the first 8 KiB). Text can't be identified by magic bytes; this is safe
 * because text/plain is served with nosniff + a sandbox CSP and never executes.
 */
function looksLikePlainText(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return true;
}

/**
 * The content type to STORE for an upload. Only allowlisted types survive, and
 * only when the bytes actually are that type; everything else is stored as
 * application/octet-stream (served as a download).
 */
export function safeStoredMimeType(buf: Uint8Array, claimedType: string | null | undefined): string {
  const sniffed = sniffMimeType(buf);
  if (sniffed) return sniffed;
  if (normalizeMimeType(claimedType) === "text/plain" && looksLikePlainText(buf)) return "text/plain";
  return OCTET;
}
