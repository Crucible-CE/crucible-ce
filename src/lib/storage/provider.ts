// ---------------------------------------------------------------------------
// Storage providers — Node-only. Server imports only.
//
// Default is a local-disk provider (works with zero cloud config, like
// evidence storage), upgrading to S3-compatible (AWS S3 / R2 / MinIO / B2)
// when STORAGE_S3_BUCKET is set. Providers store WHATEVER bytes
// they are handed — encryption is the caller's job (evidence / export storage),
// so at-rest protection is identical across backends.
// ---------------------------------------------------------------------------

import { promises as fs } from "fs";
import path from "path";
import type { StorageProvider } from "./index";

// The S3 SDK is imported lazily, only when STORAGE_S3_BUCKET selects it,
// through a non-literal specifier so the filesystem-default path never loads it.
const optionalImport = (m: string): Promise<Record<string, unknown>> =>
  import(/* @vite-ignore */ m) as Promise<Record<string, unknown>>;

export type StorageBackend = "filesystem" | "s3";

export function activeStorageBackend(): StorageBackend {
  if (process.env.STORAGE_S3_BUCKET) return "s3";
  return "filesystem";
}

// --- Filesystem (default) --------------------------------------------------
class FilesystemStorageProvider implements StorageProvider {
  private root = process.env.STORAGE_DIR ?? path.join(process.cwd(), "uploads", "documents");
  private full(key: string): string {
    // key is caller-built from ids only (no filename) → no traversal surface.
    return path.join(this.root, key);
  }
  async upload(key: string, data: Buffer): Promise<string> {
    const p = this.full(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
    return key;
  }
  async download(key: string): Promise<Buffer> {
    return fs.readFile(this.full(key));
  }
  async delete(key: string): Promise<void> {
    await fs.rm(this.full(key), { force: true });
  }
  async getSignedUrl(key: string): Promise<string> {
    // No object-store signing on disk — return an app-relative marker; callers
    // stream through the download route instead.
    return `/uploads/documents/${key}`;
  }
}

// --- S3-compatible ---------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
class S3StorageProvider implements StorageProvider {
  private bucket = process.env.STORAGE_S3_BUCKET!;
  private prefix = process.env.STORAGE_S3_PREFIX || "";
  private clientPromise: Promise<any> | null = null;

  private key(key: string): string {
    return this.prefix ? `${this.prefix.replace(/\/$/, "")}/${key}` : key;
  }
  private async client(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = optionalImport("@aws-sdk/client-s3").then(
        (m: any) =>
          new m.S3Client({
            region: process.env.STORAGE_S3_REGION || "us-east-1",
            ...(process.env.STORAGE_S3_ENDPOINT
              ? { endpoint: process.env.STORAGE_S3_ENDPOINT, forcePathStyle: true }
              : {}),
          }),
      );
    }
    return this.clientPromise;
  }
  async upload(key: string, data: Buffer, contentType: string): Promise<string> {
    const m: any = await optionalImport("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(new m.PutObjectCommand({ Bucket: this.bucket, Key: this.key(key), Body: data, ContentType: contentType }));
    return key;
  }
  async download(key: string): Promise<Buffer> {
    const m: any = await optionalImport("@aws-sdk/client-s3");
    const client = await this.client();
    const res = await client.send(new m.GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }
  async delete(key: string): Promise<void> {
    const m: any = await optionalImport("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(new m.DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
  }
  async getSignedUrl(key: string, expiresInSec: number): Promise<string> {
    const [m, presign]: [any, any] = await Promise.all([
      optionalImport("@aws-sdk/client-s3"),
      optionalImport("@aws-sdk/s3-request-presigner"),
    ]);
    const client = await this.client();
    return presign.getSignedUrl(client, new m.GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }), { expiresIn: expiresInSec });
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

let instance: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (instance) return instance;
  switch (activeStorageBackend()) {
    case "s3":
      instance = new S3StorageProvider();
      break;
    default:
      instance = new FilesystemStorageProvider();
  }
  return instance;
}

/** Test-only: reset the memoized provider so env changes take effect. */
export function __resetStorageForTests(): void {
  instance = null;
}
