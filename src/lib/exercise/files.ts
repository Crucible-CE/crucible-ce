// Exercise file storage (source documents, final report PDFs).
//
// Bytes go through CE's storage provider (filesystem or S3) under
// exercise-files/<orgId>/<path>, encrypted at rest with the organization key
// like incident evidence. The storage path is a random id generated here,
// never the user's filename (that is kept only in StoredFile.originalName, for
// Content-Disposition). Files are served only through src/lib/http/file-response.ts.

import { createHash, randomBytes } from "node:crypto";
import type { StoredFile } from "@prisma/client";
import { db, type DbClient } from "@/lib/db";
import { decryptBytesForOrg, encryptBytesForOrg } from "@/lib/crypto/org-crypto";
import { getStorageProvider } from "@/lib/storage/provider";
import { installOrgId } from "@/lib/exercise/settings";

const PATH_RE = /^c[a-z0-9]{24}$/;

/** A random, cuid-shaped storage name: "c" + 24 base36 chars from the CSPRNG. */
export function newStoragePath(): string {
  const bytes = randomBytes(24);
  let out = "c";
  for (const b of bytes) out += (b % 36).toString(36);
  return out;
}

/** Storage key for a stored relative path. Throws on anything that is not one of ours. */
export function storageKeyFor(organizationId: string, relative: string): string {
  if (!PATH_RE.test(relative)) throw new Error("invalid storage path");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(organizationId)) throw new Error("invalid organization id");
  return `exercise-files/${organizationId}/${relative}`;
}

export interface SaveUploadMeta {
  /** Sniffed MIME type (src/lib/exercise/ingest/upload.ts), never the client's claim. */
  mime: string;
  /** The user's filename, stored for display and downloads only. */
  originalName: string;
}

function cleanOriginalName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  return cleaned || "upload";
}

/** Write the bytes and create the StoredFile row. The bytes are removed again if the row fails. */
export async function saveUpload(buffer: Uint8Array, meta: SaveUploadMeta, client: DbClient = db): Promise<StoredFile> {
  const organizationId = await installOrgId(client);
  if (!organizationId) throw new Error("no organization: finish setup first");
  const rel = newStoragePath();
  const key = storageKeyFor(organizationId, rel);
  const plain = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const storage = getStorageProvider();
  await storage.upload(key, await encryptBytesForOrg(organizationId, plain), "application/octet-stream");
  try {
    return await client.storedFile.create({
      data: {
        organizationId,
        path: rel,
        mime: meta.mime,
        size: buffer.byteLength,
        sha256: createHash("sha256").update(plain).digest("hex"),
        originalName: cleanOriginalName(meta.originalName),
      },
    });
  } catch (err) {
    await storage.delete(key).catch(() => {});
    throw err;
  }
}

/** The row and its bytes, or null when either is missing. */
export async function readStoredFile(id: string, client: DbClient = db): Promise<{ file: StoredFile; bytes: Buffer } | null> {
  const file = await client.storedFile.findUnique({ where: { id } });
  if (!file) return null;
  try {
    const blob = await getStorageProvider().download(storageKeyFor(file.organizationId, file.path));
    return { file, bytes: await decryptBytesForOrg(file.organizationId, blob) };
  } catch {
    return null;
  }
}

/** Delete the row and the bytes. Returns false when the row did not exist. */
export async function deleteStoredFile(id: string, client: DbClient = db): Promise<boolean> {
  const file = await client.storedFile.findUnique({ where: { id } });
  if (!file) return false;
  await client.storedFile.delete({ where: { id } });
  await getStorageProvider()
    .delete(storageKeyFor(file.organizationId, file.path))
    .catch(() => {});
  return true;
}
