// KEK (Key-Encryption-Key) provider — wraps/unwraps per-org Data Encryption
// Keys. The KEK NEVER encrypts data directly; it only wraps DEKs.
//
// CE has exactly one KEK source: the MASTER_KEK env var. Keep it in your
// platform's secret store, which should encrypt secrets at rest. There is no
// cloud-KMS backend; see assertKmsProviderConfigured below.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface Kms {
  /** A stable id for the active KEK (so rotations can identify which KEK wrapped a DEK). */
  kekId(): string;
  /** Wrap a 32-byte plaintext DEK. Returns base64. */
  wrapDek(dek: Buffer): string;
  /** Unwrap a previously wrapped DEK back to 32 bytes. */
  unwrapDek(wrapped: string): Buffer;
}

function loadKek(): Buffer {
  const raw = process.env.MASTER_KEK;
  if (!raw) {
    throw new Error("MASTER_KEK is not set — required to wrap per-org data keys.");
  }
  const key = raw.length === 64 ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MASTER_KEK must decode to 32 bytes (64-hex or 44-base64).");
  return key;
}

// AES-256-GCM envelope. Format: base64( iv(12) || tag(16) || ciphertext ).
class EnvKms implements Kms {
  private key: Buffer | null = null;
  private id: string | null = null;
  private kek(): Buffer {
    if (!this.key) {
      this.key = loadKek();
      // kekId = first 8 bytes of SHA-256(KEK) — identifies the key without revealing it.
      this.id = "kek_" + createHash("sha256").update(this.key).digest("hex").slice(0, 16);
    }
    return this.key;
  }
  kekId(): string { this.kek(); return this.id!; }
  wrapDek(dek: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.kek(), iv, { authTagLength: 16 });
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
  }
  unwrapDek(wrapped: string): Buffer {
    const buf = Buffer.from(wrapped, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.kek(), iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }
}

let instance: Kms | null = null;

/** Test-only: clear the singleton so env changes take effect. */
export function __resetKmsForTests(): void {
  instance = null;
}

export function getKms(): Kms {
  if (!instance) instance = new EnvKms();
  return instance;
}

/**
 * Boot assertion. CE has no cloud-KMS backend, so a leftover KMS_PROVIDER that
 * names one (aws, gcp, azure, ...) must stop the boot rather than let an
 * operator believe the KEK lives in an HSM while it is really MASTER_KEK.
 * Unset or "env" is fine. Deliberately does NOT require the KEK secret itself
 * (build/CI may legitimately lack MASTER_KEK); EnvKms loads it lazily.
 */
export function assertKmsProviderConfigured(): void {
  const provider = (process.env.KMS_PROVIDER ?? "").trim().toLowerCase();
  if (provider !== "" && provider !== "env") {
    throw new Error(
      `KMS_PROVIDER="${provider}" is not supported: Crucible CE always uses MASTER_KEK. ` +
        "Remove KMS_PROVIDER (or set it to env).",
    );
  }
}
