// Bounded multipart upload reader for the evidence + task-attachment routes.
//
// `req.formData()` buffers the WHOLE body before a route can look at the file
// size, so a 5 GB POST would be read into memory before the 413. Instead:
//   - a declared Content-Length over the cap is refused before reading a byte;
//   - the body is read chunk by chunk and abandoned the moment it passes the
//     cap (covers chunked bodies with no Content-Length);
//   - only then is the (bounded) body parsed as multipart.
// The cap is MAX_ATTACHMENT_BYTES (default 100 MB) plus a small allowance for
// the multipart framing and the text fields.
//
// Memory (#10): the body lands in ONE buffer (preallocated from a declared
// Content-Length), and the multipart parser below returns each file as a
// zero-copy VIEW into it — no Request/FormData/File/arrayBuffer round trip.
// Hashing reads that view, and encryption writes one output buffer
// (org-crypto), so an upload costs ~2x its size instead of ~6x.
//
// Concurrency: at most MAX_CONCURRENT_UPLOADS (default 4) bodies are being
// read/processed per process. Over the cap → 503 + Retry-After. The slot is
// taken just before the body is read (after auth) and released when the
// route handler finishes; routes opt in by wrapping their handler in
// withUploadSlot().

import { NextResponse } from "next/server";

const DEFAULT_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024; // 100 MB
/** Multipart boundaries, part headers, and the small text fields. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const DEFAULT_MAX_CONCURRENT_UPLOADS = 4;
const UPLOAD_BUSY_RETRY_AFTER_SECONDS = 5;
const MAX_PARTS = 64;
const MAX_PART_HEADER_BYTES = 8 * 1024;

/** Max bytes for one uploaded file (MAX_ATTACHMENT_BYTES env, default 100 MB). */
export function maxAttachmentBytes(): number {
  const raw = Number(process.env.MAX_ATTACHMENT_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_ATTACHMENT_BYTES;
}

/** Max uploads processed at once per process (MAX_CONCURRENT_UPLOADS env, default 4). */
export function maxConcurrentUploads(): number {
  const raw = Number(process.env.MAX_CONCURRENT_UPLOADS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_MAX_CONCURRENT_UPLOADS;
}

function tooLarge(maxBytes: number): NextResponse {
  const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
  return NextResponse.json({ error: `File is over the ${mb} MB limit.` }, { status: 413 });
}

function badMultipart(): NextResponse {
  return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
}

// ---------------------------------------------------------------------------
// Process-wide upload slots
// ---------------------------------------------------------------------------

interface UploadSlotState {
  active: number;
  leases: WeakMap<Request, { held: boolean }>;
}

// On globalThis so every route bundle (Next may duplicate this module per
// entry) shares ONE counter for the whole process.
const SLOT_KEY = Symbol.for("crucible.uploadSlots");
function slotState(): UploadSlotState {
  const g = globalThis as unknown as Record<symbol, UploadSlotState | undefined>;
  return (g[SLOT_KEY] ??= { active: 0, leases: new WeakMap() });
}

/** Uploads currently holding a slot (for tests / diagnostics). */
export function activeUploadCount(): number {
  return slotState().active;
}

function uploadBusy(): NextResponse {
  return NextResponse.json(
    { error: "Too many uploads in progress. Try again shortly.", code: "upload_busy" },
    { status: 503, headers: { "Retry-After": String(UPLOAD_BUSY_RETRY_AFTER_SECONDS) } },
  );
}

/**
 * Wrap an upload route handler so the slot readBoundedMultipart() takes is
 * always released when the handler finishes (success, error response, or
 * throw) — i.e. after hashing, encryption and storage are done with the bytes.
 */
export function withUploadSlot<C>(
  handler: (req: Request, context: C) => Promise<Response>,
): (req: Request, context: C) => Promise<Response> {
  return async (req, context) => {
    const state = slotState();
    const lease = { held: false };
    state.leases.set(req, lease);
    try {
      return await handler(req, context);
    } finally {
      if (lease.held) {
        lease.held = false;
        state.active = Math.max(0, state.active - 1);
      }
      state.leases.delete(req);
    }
  };
}

/** Take a slot for `req` if it runs under withUploadSlot. False = over the cap. */
function acquireSlot(req: Request): boolean {
  const state = slotState();
  const lease = state.leases.get(req);
  if (!lease) return true; // not wrapped (e.g. a unit test calling the reader directly): no gate
  if (lease.held) return true;
  if (state.active >= maxConcurrentUploads()) return false;
  state.active++;
  lease.held = true;
  return true;
}

// ---------------------------------------------------------------------------
// Multipart parsing (zero-copy file parts)
// ---------------------------------------------------------------------------

/** One uploaded file. `bytes` is a view into the request body buffer (no copy). */
export class UploadedFile {
  constructor(
    readonly name: string,
    readonly type: string,
    readonly bytes: Buffer,
  ) {}
  get size(): number {
    return this.bytes.length;
  }
  /** Compatibility with the File API. COPIES — prefer `bytes`. */
  async arrayBuffer(): Promise<ArrayBuffer> {
    const ab = new ArrayBuffer(this.bytes.length);
    new Uint8Array(ab).set(this.bytes);
    return ab;
  }
}

export type FormValue = string | UploadedFile;

/** The subset of FormData the upload routes use, over parsed parts. */
export class ParsedForm {
  constructor(private readonly parts: [string, FormValue][]) {}
  get(name: string): FormValue | null {
    return this.parts.find(([k]) => k === name)?.[1] ?? null;
  }
  getAll(name: string): FormValue[] {
    return this.parts.filter(([k]) => k === name).map(([, v]) => v);
  }
  has(name: string): boolean {
    return this.parts.some(([k]) => k === name);
  }
  entries(): IterableIterator<[string, FormValue]> {
    return this.parts[Symbol.iterator]();
  }
}

/** Extract the boundary parameter from a multipart Content-Type. */
function boundaryOf(contentType: string): string | null {
  const m = /;\s*boundary=(?:"([^"]{1,70})"|([^\s;]{1,70}))/i.exec(contentType);
  return m ? (m[1] ?? m[2]) : null;
}

/** Parse `form-data; name="x"; filename="y"` parameters (quoted-string aware). */
function parseDisposition(value: string): { type: string; params: Record<string, string> } | null {
  const semi = value.indexOf(";");
  const type = (semi < 0 ? value : value.slice(0, semi)).trim().toLowerCase();
  const params: Record<string, string> = {};
  const re = /;\s*([^\s=;]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g;
  let m: RegExpExecArray | null;
  const rest = semi < 0 ? "" : value.slice(semi);
  while ((m = re.exec(rest))) {
    const key = m[1].toLowerCase();
    params[key] = m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : m[3].trim();
  }
  return { type, params };
}

/** HTML's multipart/form-data encoding escapes only `"`, CR and LF in names. */
function decodeFormName(s: string): string {
  return s.replace(/%22/g, '"').replace(/%0D/gi, "\r").replace(/%0A/gi, "\n");
}

function decodeExtValue(v: string): string | null {
  // RFC 5987: charset'lang'percent-encoded
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

/**
 * Parse a multipart/form-data body. File parts are returned as views into
 * `body` (no copy); text parts are decoded as UTF-8. Returns null when the
 * body is malformed.
 */
export function parseMultipart(body: Buffer, contentType: string): ParsedForm | null {
  const boundary = boundaryOf(contentType);
  if (!boundary) return null;
  const delim = Buffer.from(`--${boundary}`);
  const sep = Buffer.concat([CRLF, delim]);

  // First delimiter: at offset 0, or after a preamble ending in CRLF.
  let pos = body.subarray(0, delim.length).equals(delim) ? 0 : body.indexOf(sep);
  if (pos < 0) return null;
  if (pos > 0) pos += CRLF.length;

  const parts: [string, FormValue][] = [];
  for (;;) {
    let cur = pos + delim.length;
    if (body[cur] === 0x2d && body[cur + 1] === 0x2d) break; // closing "--"
    // Transport padding (LWSP) is allowed before the CRLF.
    while (body[cur] === 0x20 || body[cur] === 0x09) cur++;
    if (body[cur] !== 0x0d || body[cur + 1] !== 0x0a) return null;
    const headersStart = cur + 2;
    const headersEnd = body.indexOf(HEADER_END, headersStart);
    if (headersEnd < 0 || headersEnd - headersStart > MAX_PART_HEADER_BYTES) return null;
    const next = body.indexOf(sep, headersEnd + HEADER_END.length);
    if (next < 0) return null;
    if (parts.length >= MAX_PARTS) return null;

    let disposition: ReturnType<typeof parseDisposition> = null;
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
      const filename = (p["filename*"] !== undefined ? decodeExtValue(p["filename*"]) : null) ?? decodeFormName(p.filename ?? "");
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

export type BoundedFormResult =
  | { ok: true; form: ParsedForm }
  | { ok: false; response: NextResponse };

/**
 * Read a multipart body without ever holding more than `maxFileBytes` (+ the
 * multipart overhead) in memory. Returns the parsed form, or a 413 / 400, or
 * a 503 when MAX_CONCURRENT_UPLOADS uploads are already in flight.
 */
export async function readBoundedMultipart(req: Request, maxFileBytes: number = maxAttachmentBytes()): Promise<BoundedFormResult> {
  const limit = maxFileBytes + MULTIPART_OVERHEAD_BYTES;
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return { ok: false, response: badMultipart() };
  }
  const declaredRaw = req.headers.get("content-length");
  const declared = declaredRaw === null ? NaN : Number(declaredRaw);
  if (Number.isFinite(declared) && declared > limit) return { ok: false, response: tooLarge(maxFileBytes) };
  if (!req.body) return { ok: false, response: NextResponse.json({ error: "No file provided" }, { status: 400 }) };

  if (!acquireSlot(req)) {
    await req.body.cancel().catch(() => {});
    return { ok: false, response: uploadBusy() };
  }

  const reader = req.body.getReader();
  let body: Buffer;
  if (Number.isInteger(declared) && declared >= 0) {
    // Known length: fill ONE preallocated buffer.
    const buf = Buffer.allocUnsafe(declared);
    let off = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (off + value.byteLength > declared) {
        await reader.cancel().catch(() => {});
        return { ok: false, response: off + value.byteLength > limit ? tooLarge(maxFileBytes) : badMultipart() };
      }
      buf.set(value, off);
      off += value.byteLength;
    }
    body = off === declared ? buf : buf.subarray(0, off);
  } else {
    // Chunked (no Content-Length): collect, then join once.
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
    body = Buffer.concat(chunks, total);
    chunks.length = 0;
  }

  const form = parseMultipart(body, contentType);
  if (!form) return { ok: false, response: badMultipart() };
  // A NUL (U+0000) in a text field or a file name 500s at Postgres (text
  // columns reject it): refuse it here as a 400 for every multipart route.
  for (const [key, value] of form.entries()) {
    const text = typeof value === "string" ? value : value.name;
    if (key.includes("\u0000") || text.includes("\u0000")) {
      return { ok: false, response: NextResponse.json({ error: "Text must not contain NUL (U+0000) characters" }, { status: 400 }) };
    }
  }
  return { ok: true, form };
}
