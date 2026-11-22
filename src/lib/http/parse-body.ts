import { NextResponse } from "next/server";
import type { z } from "zod";

// Shared JSON-body parser (foundations §2.2). Returns an error response (never
// throws) so routes stop 500-ing on empty/garbage bodies. Uses the codebase's
// canonical error shape.
//
//   415  a body is present but Content-Type is not application/json (also a
//        CSRF backstop: a cross-site "simple" request can only send
//        text/plain, form-urlencoded or multipart without a preflight)
//   413  body larger than MAX_JSON_BODY_BYTES (Content-Length or actual bytes)
//   400  malformed / empty JSON, a string containing a NUL (U+0000) anywhere
//        in the parsed value (Postgres text columns reject it -> 500), or a
//        schema mismatch
//
// Convention:
//   const p = await parseJsonBody(req, schema);
//   if (!p.ok) return p.response;
//   // use p.data   (typed)
export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

/** Hard cap on a JSON request body. File uploads use multipart, not this. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024; // 1 MB

function fail(status: number, error: string, details?: unknown): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json(details === undefined ? { error } : { error, details }, { status }),
  };
}

const malformed = () => fail(400, "Invalid input", "Malformed or empty JSON body");
const tooLarge = (max: number) => fail(413, "Payload too large", `JSON body exceeds ${max} bytes`);

/** True for `application/json` and `application/<x>+json`, any parameters. */
export function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const mime = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return mime === "application/json" || /^application\/[a-z0-9.+-]+\+json$/.test(mime);
}

/** True when any string (value or object key) in `value` contains U+0000. */
export function containsNulByte(value: unknown, depth = 0): boolean {
  if (depth > 200) return true; // pathological nesting: treat as invalid
  if (typeof value === "string") return value.includes("\u0000");
  if (Array.isArray(value)) return value.some((v) => containsNulByte(v, depth + 1));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k.includes("\u0000") || containsNulByte(v, depth + 1)) return true;
    }
  }
  return false;
}

/** Read the body as UTF-8, aborting past `max` bytes. null = too large. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(buf);
}

// The input type parameter is left free so schemas whose input differs from
// their output (.default(), .transform()) infer T as the OUTPUT type —
// z.ZodType<T> alone would collapse them and type defaulted fields undefined.
export async function parseJsonBody<T, I = unknown>(
  req: Request,
  schema: z.ZodType<T, z.ZodTypeDef, I>,
  opts: { maxBytes?: number } = {},
): Promise<ParseResult<T>> {
  const maxBytes = opts.maxBytes ?? MAX_JSON_BODY_BYTES;

  // No body at all is the "empty JSON" 400 it always was (no Content-Type to
  // police); any body that IS sent must be declared JSON.
  if (!req.body) return malformed();
  if (!isJsonContentType(req.headers.get("content-type"))) {
    return fail(415, "Unsupported media type", "Content-Type must be application/json");
  }

  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) return tooLarge(maxBytes);

  let text: string | null;
  try {
    text = await readCapped(req, maxBytes);
  } catch {
    return malformed();
  }
  if (text === null) return tooLarge(maxBytes);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return malformed();
  }
  if (containsNulByte(raw)) {
    return fail(400, "Invalid input", "Text must not contain NUL (U+0000) characters");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return fail(400, "Invalid input", parsed.error.flatten());
  return { ok: true, data: parsed.data };
}
