// Encrypted case-file (.cxz) package storage.
//
// Filesystem mode (default, today's production config — no object-storage env
// set): bytes live on disk under a git-ignored / volume-mounted dir, keyed by
// export id. This path is UNTOUCHED by the object-storage cutover below — it
// must remain a byte-for-byte no-op until a bucket is actually configured.
//
// Object-storage mode (STORAGE_S3_BUCKET
// set): bytes route through getStorageProvider() instead, under
// `exports/{orgId}/{incidentId}/{exportId}.cxz`. Reads try the provider first
// and fall back to the legacy on-disk path on a not-found error, so packages
// built before the cutover keep working until backfilled
// (copy them into the bucket at the same key). Deletes attempt both locations.
//
// Contract note: writeExportPackage's return value is stamped onto
// IncidentExport.storagePath by build.ts, but nothing ever reads that column
// back to locate the file — every read/delete call (build.ts, the download
// route, this module) recomputes the path/key from (orgId, incidentId,
// exportId) parameters, never from the stored value. So legacy absolute paths
// already persisted in the DB are inert strings; changing what this function
// returns (an object-storage key instead of an absolute path) is safe and
// requires no migration or parsing of old values.
import { promises as fs } from "fs";
import path from "path";
import { activeStorageBackend, getStorageProvider } from "@/lib/storage/provider";

// Read lazily (not a module-level const) so tests can point EXPORT_DIR at a
// temp dir per-run; in production the env is fixed at process boot anyway, so
// this is behaviorally identical to a one-time read.
function root(): string {
  return process.env.EXPORT_DIR ?? path.join(process.cwd(), "uploads", "exports");
}

function pkgPath(orgId: string, incidentId: string, exportId: string): string {
  return path.join(root(), orgId, incidentId, `${exportId}.cxz`);
}

function storageKey(orgId: string, incidentId: string, exportId: string): string {
  return `exports/${orgId}/${incidentId}/${exportId}.cxz`;
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

export async function writeExportPackage(orgId: string, incidentId: string, exportId: string, data: Buffer): Promise<string> {
  if (activeStorageBackend() === "filesystem") {
    const p = pkgPath(orgId, incidentId, exportId);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
    return p;
  }

  const key = storageKey(orgId, incidentId, exportId);
  await getStorageProvider().upload(key, data, "application/octet-stream");
  return key;
}

export async function readExportPackage(orgId: string, incidentId: string, exportId: string): Promise<Buffer> {
  if (activeStorageBackend() === "filesystem") {
    return fs.readFile(pkgPath(orgId, incidentId, exportId));
  }

  try {
    return await getStorageProvider().download(storageKey(orgId, incidentId, exportId));
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    // Not yet backfilled into object storage — fall back to the legacy disk
    // path. This log line drives the cutover soak: once it goes silent, the
    // backfill is complete and the fallback can be retired.
    console.warn(
      `[export-storage] legacy-disk fallback hit orgId=${orgId} incidentId=${incidentId} exportId=${exportId}`,
    );
    return fs.readFile(pkgPath(orgId, incidentId, exportId));
  }
}

export async function deleteExportPackage(orgId: string, incidentId: string, exportId: string): Promise<void> {
  if (activeStorageBackend() === "filesystem") {
    await fs.rm(pkgPath(orgId, incidentId, exportId), { force: true });
    return;
  }

  await Promise.allSettled([
    getStorageProvider().delete(storageKey(orgId, incidentId, exportId)),
    fs.rm(pkgPath(orgId, incidentId, exportId), { force: true }),
  ]);
}
