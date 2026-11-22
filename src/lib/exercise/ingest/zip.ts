// Minimal ZIP central-directory reader. Used to sniff DOCX uploads (does it
// contain word/document.xml, any macro parts) and to read one small entry
// with a hard output cap. Never inflates more than asked for.

import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  /** As declared in the central directory. 0xFFFFFFFF (Zip64) is kept as-is. */
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
export const MAX_ZIP_ENTRIES = 5000;

export function isZip(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

/** Entries from the central directory, or null when the archive is malformed. */
export function listZipEntries(input: Uint8Array): ZipEntry[] | null {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buf.length < 22) return null;
  const minStart = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ZIP_ENTRIES) return null;
  if (cdOffset + cdSize > buf.length) return null;

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CDH_SIG) return null;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > buf.length) return null;
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Sum of declared uncompressed sizes. */
export function declaredUncompressedTotal(entries: ZipEntry[]): number {
  return entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
}

/** Read one entry's bytes, inflating at most `maxBytes`. Null when unreadable or over the cap. */
export function readZipEntry(input: Uint8Array, entry: ZipEntry, maxBytes: number): Buffer | null {
  const r = inflateZipEntry(input, entry, maxBytes);
  return r.ok ? r.data : null;
}

export type InflateResult = { ok: true; data: Buffer } | { ok: false; reason: "over_limit" | "unreadable" };

/**
 * Inflate one entry, producing at most `maxBytes`. The declared uncompressed
 * size is never trusted: zlib stops at the cap and the result is over_limit.
 */
export function inflateZipEntry(input: Uint8Array, entry: ZipEntry, maxBytes: number): InflateResult {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const unreadable = { ok: false, reason: "unreadable" } as const;
  const over = { ok: false, reason: "over_limit" } as const;
  const p = entry.localHeaderOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== LFH_SIG) return unreadable;
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > buf.length) return unreadable;
  const data = buf.subarray(start, end);
  if (entry.method === 0) return data.length <= maxBytes ? { ok: true, data: Buffer.from(data) } : over;
  if (entry.method !== 8) return unreadable;
  try {
    const out = inflateRawSync(data, { maxOutputLength: Math.max(1, maxBytes) });
    return out.length <= maxBytes ? { ok: true, data: out } : over;
  } catch (err) {
    return (err as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE" ? over : unreadable;
  }
}
