// ---------------------------------------------------------------------------
// Storage abstraction — pluggable provider interface.
//
// This barrel is import-safe from CLIENT bundles: it exports only the type and
// the STORAGE_AVAILABLE flag (a literal true — the filesystem default always
// works). The Node-only provider implementations live in ./provider and must
// be imported from server code.
// ---------------------------------------------------------------------------

export interface StorageProvider {
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSec: number): Promise<string>;
}

