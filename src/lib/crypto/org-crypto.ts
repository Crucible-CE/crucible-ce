// Data-at-rest encryption for Crucible CE.
//
// The org DEK is derived directly from the install's master key (MASTER_KEK)
// via HKDF — no key rows to manage. Wire format for binary blobs (evidence,
// exports):
//   CXO1 || iv || tag || ct
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

function masterKey(): Buffer {
  const raw = process.env.MASTER_KEK;
  if (!raw) {
    throw new Error("MASTER_KEK is not set — required to encrypt data at rest.");
  }
  const key = raw.length === 64 ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MASTER_KEK must decode to 32 bytes (64-hex or 44-base64).");
  return key;
}

const subkeyCache = new Map<string, Buffer>();

/**
 * Derive a purpose-bound 32-byte subkey from the install master key
 * (HKDF-SHA256, salt "crucible-ce", info = `info`). Used for keys that are not
 * per-org DEKs, e.g. the ledger entry-hash HMAC key (info "ledger-v1"). The
 * master key itself is never used directly.
 */
export function deriveMasterSubkey(info: string): Buffer {
  const cached = subkeyCache.get(info);
  if (cached) return cached;
  const k = Buffer.from(hkdfSync("sha256", masterKey(), "crucible-ce", info, 32));
  subkeyCache.set(info, k);
  return k;
}

/** Test-only: forget cached derived keys so MASTER_KEK changes take effect. */
export function __resetDerivedKeysForTests(): void {
  subkeyCache.clear();
  dekCache.clear();
}

const dekCache = new Map<string, Buffer>();

/** Derive the org's DEK from the install master key. Deterministic per org. */
export async function getOrgDek(organizationId: string): Promise<Buffer> {
  const cached = dekCache.get(organizationId);
  if (cached) return cached;
  const dek = Buffer.from(hkdfSync("sha256", masterKey(), organizationId, "crucible-ce-org-dek", 32));
  dekCache.set(organizationId, dek);
  return dek;
}

// ---- binary blobs (evidence, packages) ------------------------------------
// Format: magic "CXO1" || iv(12) || tag(16) || ciphertext.
const BLOB_MAGIC = Buffer.from("CXO1");
export async function encryptBytesForOrg(organizationId: string, data: Buffer): Promise<Buffer> {
  const dek = await getOrgDek(organizationId);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dek, iv, { authTagLength: 16 });
  // Write straight into ONE output buffer, encrypting in 1 MiB slices, so a
  // large upload isn't copied through ct + concat (GCM output == input size).
  const out = Buffer.allocUnsafe(BLOB_HEADER_BYTES + data.length);
  BLOB_MAGIC.copy(out, 0);
  iv.copy(out, 4);
  let off = BLOB_HEADER_BYTES;
  for (let i = 0; i < data.length; i += CRYPT_SLICE_BYTES) {
    off += cipher.update(data.subarray(i, Math.min(i + CRYPT_SLICE_BYTES, data.length))).copy(out, off);
  }
  off += cipher.final().copy(out, off);
  cipher.getAuthTag().copy(out, 16);
  return off === out.length ? out : out.subarray(0, off);
}

const BLOB_HEADER_BYTES = 32; // magic(4) + iv(12) + tag(16)
const CRYPT_SLICE_BYTES = 1024 * 1024;

export async function decryptBytesForOrg(organizationId: string, blob: Buffer): Promise<Buffer> {
  // Tolerate legacy unencrypted blobs (written before at-rest encryption),
  // but say so: every blob this version writes is encrypted, so a plaintext
  // read means a pre-encryption file or one written outside the app.
  if (blob.length < 32 || !blob.subarray(0, 4).equals(BLOB_MAGIC)) {
    console.warn(`[crypto] read an UNENCRYPTED blob (${blob.length} bytes) for org ${organizationId}; it was not written by this version's at-rest encryption`);
    return blob;
  }
  const dek = await getOrgDek(organizationId);
  const iv = blob.subarray(4, 16);
  const tag = blob.subarray(16, 32);
  const ct = blob.subarray(32);
  const decipher = createDecipheriv("aes-256-gcm", dek, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const pt = decipher.update(ct);
  const fin = decipher.final(); // throws on a bad tag; GCM yields no trailing bytes
  return fin.length ? Buffer.concat([pt, fin]) : pt;
}
