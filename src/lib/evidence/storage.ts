// ---------------------------------------------------------------------------
// Evidence blob storage.
//
// Filesystem mode (default, and today's production config — no object-storage
// env set): bytes live on disk under a git-ignored / volume-mounted dir, keyed
// by DB id. This path is UNTOUCHED by the object-storage cutover below — it
// must remain a byte-for-byte no-op so existing prod behavior (EVIDENCE_DIR on
// a mounted volume) never changes until a bucket is actually configured.
//
// Object-storage mode (STORAGE_S3_BUCKET
// set): bytes route through getStorageProvider() instead, under
// `evidence/{orgId}/{incidentId}/{evidenceId}`. Reads try the provider first
// and fall back to the legacy on-disk path on a not-found error, so blobs
// written before the cutover keep working until backfilled
// (copy them into the bucket at the same key). Deletes attempt both locations.
// ---------------------------------------------------------------------------

import { promises as fs } from "fs";
import path from "path";
import { encryptBytesForOrg, decryptBytesForOrg } from "@/lib/crypto/org-crypto";
import { activeStorageBackend, getStorageProvider } from "@/lib/storage/provider";

// Read lazily (not a module-level const) so tests can point EVIDENCE_DIR at a
// temp dir per-run; in production the env is fixed at process boot anyway, so
// this is behaviorally identical to a one-time read.
function root(): string {
  return process.env.EVIDENCE_DIR ?? path.join(process.cwd(), "uploads", "evidence");
}

function blobPath(orgId: string, incidentId: string, evidenceId: string): string {
  return path.join(root(), orgId, incidentId, evidenceId);
}

function storageKey(orgId: string, incidentId: string, evidenceId: string): string {
  return `evidence/${orgId}/${incidentId}/${evidenceId}`;
}

/** Best-effort "object not found" check across fs and S3 error shapes. */
function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  if (e.code === "ENOENT") return true; // Node fs
  const name = typeof e.name === "string" ? e.name : "";
  if (name === "NoSuchKey" || name === "NotFound") return true; // AWS SDK v3
  if (e.Code === "NoSuchKey" || e.code === "NoSuchKey" || e.code === "BlobNotFound") return true;
  const meta = e.$metadata as Record<string, unknown> | undefined;
  const status = (meta?.httpStatusCode as number | undefined) ?? (e.statusCode as number | undefined);
  if (status === 404) return true;
  return false;
}

export async function writeEvidence(
  orgId: string,
  incidentId: string,
  evidenceId: string,
  data: Buffer,
): Promise<void> {
  // Encrypt at rest under the org's own DEK.
  const ciphertext = await encryptBytesForOrg(orgId, data);

  if (activeStorageBackend() === "filesystem") {
    const p = blobPath(orgId, incidentId, evidenceId);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, ciphertext);
    return;
  }

  await getStorageProvider().upload(
    storageKey(orgId, incidentId, evidenceId),
    ciphertext,
    "application/octet-stream",
  );
}

export async function readEvidence(
  orgId: string,
  incidentId: string,
  evidenceId: string,
): Promise<Buffer> {
  if (activeStorageBackend() === "filesystem") {
    // decryptBytesForOrg transparently passes through legacy unencrypted blobs.
    return decryptBytesForOrg(orgId, await fs.readFile(blobPath(orgId, incidentId, evidenceId)));
  }

  try {
    const ciphertext = await getStorageProvider().download(storageKey(orgId, incidentId, evidenceId));
    return decryptBytesForOrg(orgId, ciphertext);
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    // Not yet backfilled into object storage — fall back to the legacy disk
    // path. This log line drives the cutover soak: once it goes silent, the
    // backfill is complete and the fallback can be retired.
    console.warn(
      `[evidence-storage] legacy-disk fallback hit orgId=${orgId} incidentId=${incidentId} evidenceId=${evidenceId}`,
    );
    const legacy = await fs.readFile(blobPath(orgId, incidentId, evidenceId));
    return decryptBytesForOrg(orgId, legacy);
  }
}

export async function deleteEvidence(
  orgId: string,
  incidentId: string,
  evidenceId: string,
): Promise<void> {
  if (activeStorageBackend() === "filesystem") {
    await fs.rm(blobPath(orgId, incidentId, evidenceId), { force: true });
    return;
  }

  // Attempt both locations — the blob may live in either place depending on
  // whether it predates the cutover / backfill. Ignore either being missing.
  await Promise.allSettled([
    getStorageProvider().delete(storageKey(orgId, incidentId, evidenceId)),
    fs.rm(blobPath(orgId, incidentId, evidenceId), { force: true }),
  ]);
}
