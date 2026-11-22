// Offline check of an evidence bundle (see bundle.ts). No database.
//
// PASS needs all of:
//   - manifest.json and manifest.sig present; manifest.sig is strict base64
//     and verifies (Ed25519) over the exact bytes of manifest.json with the
//     bundled manifest key (manifest-key.pem, else public-key.pem);
//   - every file listed with matching sha256 and size, and no unlisted file;
//   - public-key.pem matches the manifest keyId;
//   - aar.signed.json verifies against public-key.pem, its contentHash equals
//     sha256 of the canonical document and the manifest's contentHash.
// The keys come from the bundle itself, so a PASS here only shows the files
// match the bundled key. scripts/verify-bundle.ts requires --key to pin the
// signer to a key the instance publishes.
//
// Inflation is capped: at most MAX_ENTRIES entries and MAX_INFLATED_BYTES in
// total, checked from the zip directory before anything is inflated.

import { createPublicKey, verify as edVerify } from "node:crypto";
import JSZip from "jszip";
import { canonicalize } from "./canonical";
import { sha256Hex, signingPayload, verifyEnvelope, type SignedEnvelope } from "./sign";
import { keyIdFor } from "./keys";

const MANIFEST_PATH = "manifest.json";
const MANIFEST_SIG_PATH = "manifest.sig";
const ENVELOPE_PATH = "aar.signed.json";
const PUBLIC_KEY_PATH = "public-key.pem";
const MANIFEST_KEY_PATH = "manifest-key.pem";
const MANIFEST_SIG_BIN_PATH = "manifest.sig.bin";
const PAYLOAD_PATH = "aar.signed-payload.json";
const SIGNATURE_BIN_PATH = "aar.signature.bin";

/** Total uncompressed bytes a bundle may expand to. */
export const MAX_INFLATED_BYTES = 100 * 1024 * 1024;
/** Entries a bundle may hold. */
export const MAX_ENTRIES = 200;

export interface BundleVerifyResult {
  ok: boolean;
  reasons: string[];
  /** Key that signed aar.signed.json. */
  keyId: string | null;
  /** Key that signed manifest.json (the same key unless the instance rotated). */
  manifestKeyId: string | null;
  /** SPKI PEMs of those keys as found in the bundle, for pinning against a file. */
  publicKeyPem: string | null;
  manifestKeyPem: string | null;
  contentHash: string | null;
  files: number;
}

interface ManifestShape {
  files: Array<{ path: string; sha256: string; bytes: number }>;
  keyId: string;
  manifestKeyId?: string;
  contentHash: string;
}

function isManifest(v: unknown): v is ManifestShape {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    Array.isArray(m.files) &&
    m.files.every((f) => f && typeof f.path === "string" && typeof f.sha256 === "string" && typeof f.bytes === "number") &&
    typeof m.keyId === "string" &&
    typeof m.contentHash === "string"
  );
}

function strictBase64(s: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s, "base64");
  return buf.toString("base64") === s ? buf : null;
}

function derHex(pem: string): string | null {
  try {
    return createPublicKey({ key: pem, format: "pem" }).export({ type: "spki", format: "der" }).toString("hex");
  } catch {
    return null;
  }
}

function keyIdOfPem(pem: string): string | null {
  try {
    const k = createPublicKey({ key: pem, format: "pem" });
    return k.asymmetricKeyType === "ed25519" ? keyIdFor(k) : null;
  } catch {
    return null;
  }
}

export async function verifyBundle(zipBytes: Uint8Array): Promise<BundleVerifyResult> {
  const reasons: string[] = [];
  const keys = { manifestKeyId: null as string | null, publicKeyPem: null as string | null, manifestKeyPem: null as string | null };
  const result = (keyId: string | null = null, contentHash: string | null = null, files = 0): BundleVerifyResult => ({
    ok: reasons.length === 0,
    reasons,
    keyId,
    ...keys,
    contentHash,
    files,
  });

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBytes, { checkCRC32: true });
  } catch (err) {
    reasons.push(`not a readable zip: ${err instanceof Error ? err.message : String(err)}`);
    return result();
  }
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  if (entries.length > MAX_ENTRIES) {
    reasons.push(`the zip holds ${entries.length} files; a bundle holds at most ${MAX_ENTRIES}`);
    return result();
  }
  let declared = 0;
  for (const entry of entries) {
    const size = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
      reasons.push(`${entry.name}: the zip directory has no size for it`);
      return result();
    }
    declared += size;
  }
  if (declared > MAX_INFLATED_BYTES) {
    reasons.push(`the zip expands to ${declared} bytes; the limit is ${MAX_INFLATED_BYTES}`);
    return result();
  }
  const contents = new Map<string, Buffer>();
  let inflated = 0;
  for (const entry of entries) {
    try {
      const bytes = await entry.async("nodebuffer");
      inflated += bytes.byteLength;
      if (inflated > MAX_INFLATED_BYTES) {
        reasons.push(`the zip expands past ${MAX_INFLATED_BYTES} bytes`);
        return result();
      }
      contents.set(entry.name, bytes);
    } catch (err) {
      reasons.push(`${entry.name}: could not be read (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  const manifestBytes = contents.get(MANIFEST_PATH);
  const sigText = contents.get(MANIFEST_SIG_PATH)?.toString("utf8");
  if (!manifestBytes) reasons.push("manifest.json is missing");
  if (sigText === undefined) reasons.push("manifest.sig is missing");
  if (!manifestBytes || sigText === undefined) return result();

  let manifest: ManifestShape;
  try {
    const parsed: unknown = JSON.parse(manifestBytes.toString("utf8"));
    if (!isManifest(parsed)) {
      reasons.push("manifest.json has the wrong shape");
      return result();
    }
    manifest = parsed;
  } catch {
    reasons.push("manifest.json is not valid JSON");
    return result();
  }

  // File hashes, sizes and completeness.
  const listed = new Set<string>();
  for (const f of manifest.files) {
    listed.add(f.path);
    const bytes = contents.get(f.path);
    if (!bytes) {
      reasons.push(`${f.path}: listed in the manifest but missing`);
      continue;
    }
    if (bytes.byteLength !== f.bytes) reasons.push(`${f.path}: size ${bytes.byteLength} does not match the manifest (${f.bytes})`);
    if (sha256Hex(bytes) !== f.sha256) reasons.push(`${f.path}: sha256 does not match the manifest`);
  }
  for (const name of contents.keys()) {
    if (name === MANIFEST_PATH || name === MANIFEST_SIG_PATH || name === MANIFEST_SIG_BIN_PATH) continue;
    if (!listed.has(name)) reasons.push(`${name}: not listed in the manifest`);
  }

  // Keys.
  const publicPem = contents.get(PUBLIC_KEY_PATH)?.toString("utf8");
  if (!publicPem) reasons.push("public-key.pem is missing");
  const publicKeyId = publicPem ? keyIdOfPem(publicPem) : null;
  if (publicPem && !publicKeyId) reasons.push("public-key.pem is not an Ed25519 public key");
  if (publicKeyId && publicKeyId !== manifest.keyId) reasons.push(`public-key.pem is key ${publicKeyId}, the manifest says ${manifest.keyId}`);
  const manifestKeyId = manifest.manifestKeyId ?? manifest.keyId;
  const manifestPem = manifestKeyId === manifest.keyId ? publicPem : contents.get(MANIFEST_KEY_PATH)?.toString("utf8");
  if (!manifestPem) reasons.push("the manifest signing key is missing");
  else if (keyIdOfPem(manifestPem) !== manifestKeyId) reasons.push("the manifest signing key does not match manifestKeyId");

  keys.manifestKeyId = manifestKeyId;
  keys.publicKeyPem = publicPem ?? null;
  keys.manifestKeyPem = manifestPem ?? null;

  // Manifest signature over the exact manifest bytes.
  const sig = strictBase64(sigText);
  if (!sig) reasons.push("manifest.sig is not valid base64");
  const sigBin = contents.get(MANIFEST_SIG_BIN_PATH);
  if (sigBin && (!sig || !sigBin.equals(sig))) reasons.push("manifest.sig.bin does not match manifest.sig");
  else if (manifestPem && sig) {
    let ok = false;
    try {
      ok = edVerify(null, manifestBytes, createPublicKey({ key: manifestPem, format: "pem" }), sig);
    } catch {
      ok = false;
    }
    if (!ok) reasons.push("manifest signature does not verify");
  }

  // Envelope.
  const envBytes = contents.get(ENVELOPE_PATH);
  let contentHash: string | null = null;
  if (!envBytes) reasons.push("aar.signed.json is missing");
  else {
    try {
      const env = JSON.parse(envBytes.toString("utf8")) as SignedEnvelope;
      contentHash = typeof env.contentHash === "string" ? env.contentHash : null;
      if (env.keyId !== manifest.keyId) reasons.push("aar.signed.json keyId does not match the manifest");
      if (publicPem) {
        const v = verifyEnvelope(env, publicPem);
        if (!v.ok) reasons.push(`aar.signed.json: ${v.reason}`);
      }
      if (sha256Hex(canonicalize(env.document)) !== manifest.contentHash) reasons.push("contentHash does not match the signed document");
      if (env.contentHash !== manifest.contentHash) reasons.push("aar.signed.json contentHash does not match the manifest");
      // The OpenSSL files must say the same as the envelope.
      const payload = contents.get(PAYLOAD_PATH);
      if (payload && !payload.equals(Buffer.from(signingPayload(env.document, env.keyId, env.signedAt), "utf8"))) {
        reasons.push("aar.signed-payload.json does not match aar.signed.json");
      }
      const sigFile = contents.get(SIGNATURE_BIN_PATH);
      if (sigFile && !sigFile.equals(Buffer.from(String(env.signature), "base64"))) reasons.push("aar.signature.bin does not match aar.signed.json");
    } catch {
      reasons.push("aar.signed.json is not valid JSON");
    }
  }

  return result(manifest.keyId, contentHash ?? manifest.contentHash, manifest.files.length);
}

/** A pinned key: a 16 hex character key ID, or an Ed25519 public key PEM. */
export type KeyPin = { keyId: string } | { pem: string };

/** Turn a --key value into a pin: a key ID, or the contents of a PEM file. Null when unusable. */
export function parsePin(value: string, readFile: (p: string) => string): KeyPin | null {
  const v = value.trim();
  if (/^[a-f0-9]{16}$/i.test(v)) return { keyId: v.toLowerCase() };
  try {
    const pem = readFile(v);
    return keyIdOfPem(pem) ? { pem } : null;
  } catch {
    return null;
  }
}

/**
 * Check a verified bundle against pinned keys. Every key the bundle used
 * (record key and manifest key) must be pinned. Pure.
 */
export function checkPins(r: BundleVerifyResult, pins: KeyPin[]): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const pinnedIds = new Set<string>();
  // A PEM pin compares the whole key, not only the 16 character ID.
  const pinnedDer = new Map<string, string>();
  for (const p of pins) {
    const id = "keyId" in p ? p.keyId : keyIdOfPem(p.pem);
    if (!id) continue;
    pinnedIds.add(id);
    if ("pem" in p) pinnedDer.set(id, derHex(p.pem) ?? "");
  }
  const used: Array<[string, string | null, string | null]> = [
    ["record", r.keyId, r.publicKeyPem],
    ["manifest", r.manifestKeyId ?? r.keyId, r.manifestKeyPem ?? r.publicKeyPem],
  ];
  for (const [what, id, pem] of used) {
    if (!id) reasons.push(`the ${what} key is unknown`);
    else if (!pinnedIds.has(id)) reasons.push(`the ${what} was signed with key ${id}, which is not a pinned key`);
    else if (pinnedDer.has(id) && (!pem || derHex(pem) !== pinnedDer.get(id))) reasons.push(`the ${what} key does not match the pinned public key file`);
  }
  return { ok: reasons.length === 0, reasons };
}
