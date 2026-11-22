// RFC 8785 JSON Canonicalization Scheme (JCS) for signing.
//
// - Object keys sorted by UTF-16 code units (JS default string sort).
// - Numbers in ECMAScript shortest form (what JSON.stringify emits); non-finite rejected.
// - Strings escaped as JSON.stringify does (which matches JCS for valid UTF-16).
// - undefined properties are omitted; undefined array items are rejected.
// - Dates are serialized as ISO strings before canonicalizing (toJSON).
//
// The signed bytes are the UTF-8 encoding of the returned string.

export class CanonicalizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizeError";
  }
}

export function canonicalize(value: unknown): string {
  return ser(value, "$");
}

function ser(v: unknown, path: string): string {
  if (v === null) return "null";
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new CanonicalizeError(`non-finite number at ${path}`);
      return JSON.stringify(v);
    case "string":
      return JSON.stringify(v);
    case "bigint":
      throw new CanonicalizeError(`bigint at ${path}`);
    case "object": {
      if (Array.isArray(v)) {
        return `[${v
          .map((item, i) => {
            if (item === undefined) throw new CanonicalizeError(`undefined array item at ${path}[${i}]`);
            return ser(item, `${path}[${i}]`);
          })
          .join(",")}]`;
      }
      const obj = v as Record<string, unknown>;
      if (typeof (obj as { toJSON?: unknown }).toJSON === "function") {
        return ser((obj as { toJSON: () => unknown }).toJSON(), path);
      }
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined && typeof obj[k] !== "function")
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${ser(obj[k], `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new CanonicalizeError(`unsupported ${typeof v} at ${path}`);
  }
}
