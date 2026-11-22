import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const { mockUpload, mockDownload, mockDelete } = vi.hoisted(() => ({
  mockUpload: vi.fn(async (key: string, _data: Buffer, _contentType: string): Promise<string> => key),
  mockDownload: vi.fn(async (_key: string): Promise<Buffer> => {
    const err = Object.assign(new Error("not found"), { name: "NoSuchKey" });
    throw err;
  }),
  mockDelete: vi.fn(async (_key: string): Promise<void> => {}),
}));
vi.mock("@/lib/storage/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/provider")>("@/lib/storage/provider");
  return {
    ...actual,
    getStorageProvider: () => ({
      upload: mockUpload,
      download: mockDownload,
      delete: mockDelete,
      getSignedUrl: vi.fn(),
    }),
  };
});

import { __resetStorageForTests } from "@/lib/storage/provider";
import { writeExportPackage, readExportPackage, deleteExportPackage } from "./storage";

const ENV = ["STORAGE_S3_BUCKET", "EXPORT_DIR"];
const saved: Record<string, string | undefined> = {};
let tmpDir = "";

beforeEach(async () => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crucible-case-file-"));
  process.env.EXPORT_DIR = tmpDir;
  __resetStorageForTests();
  mockUpload.mockClear();
  mockDownload.mockClear();
  mockDelete.mockClear();
});

afterEach(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetStorageForTests();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("export storage — filesystem mode (no-op invariant)", () => {
  it("writes/reads/deletes on disk exactly as before, returning the absolute path, never touching the provider", async () => {
    const bytes = Buffer.from("cxz package bytes");
    const storagePath = await writeExportPackage("org-1", "inc-1", "exp-1", bytes);
    expect(storagePath).toBe(path.join(tmpDir, "org-1", "inc-1", "exp-1.cxz"));

    const onDisk = await fs.readFile(storagePath);
    expect(onDisk.equals(bytes)).toBe(true);

    const back = await readExportPackage("org-1", "inc-1", "exp-1");
    expect(back.equals(bytes)).toBe(true);

    await deleteExportPackage("org-1", "inc-1", "exp-1");
    await expect(fs.readFile(storagePath)).rejects.toThrow();

    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("export storage — object-storage mode", () => {
  beforeEach(() => {
    process.env.STORAGE_S3_BUCKET = "test-bucket";
    __resetStorageForTests();
  });

  it("routes writes through the provider and returns the storage key (not a path)", async () => {
    const bytes = Buffer.from("cxz package bytes");
    const storagePath = await writeExportPackage("org-1", "inc-1", "exp-1", bytes);

    expect(storagePath).toBe("exports/org-1/inc-1/exp-1.cxz");
    expect(mockUpload).toHaveBeenCalledWith("exports/org-1/inc-1/exp-1.cxz", bytes, "application/octet-stream");
  });

  it("reads recompute the key from parameters — a legacy absolute path in the DB is never consulted", async () => {
    // Simulate a row whose `storagePath` column still holds a pre-cutover
    // absolute filesystem path. readExportPackage never takes that value —
    // it only takes ids — so the stale string is inert.
    const legacyStoragePathInDb = path.join(tmpDir, "org-1", "inc-1", "exp-1.cxz");
    void legacyStoragePathInDb; // documents the shape; unused by the read call below

    mockDownload.mockResolvedValueOnce(Buffer.from("from object storage"));
    const back = await readExportPackage("org-1", "inc-1", "exp-1");
    expect(back.toString()).toBe("from object storage");
    expect(mockDownload).toHaveBeenCalledWith("exports/org-1/inc-1/exp-1.cxz");
  });

  it("falls back to legacy disk on a provider not-found error", async () => {
    const legacyPath = path.join(tmpDir, "org-1", "inc-1", "exp-1.cxz");
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, "legacy package bytes");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const back = await readExportPackage("org-1", "inc-1", "exp-1");
    expect(back.toString()).toBe("legacy package bytes");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[export-storage] legacy-disk fallback hit"));
    warnSpy.mockRestore();
  });

  it("propagates non-not-found provider errors without falling back", async () => {
    mockDownload.mockRejectedValueOnce(new Error("boom"));
    await expect(readExportPackage("org-1", "inc-1", "exp-1")).rejects.toThrow("boom");
  });

  it("deletes from both provider and legacy disk", async () => {
    const legacyPath = path.join(tmpDir, "org-1", "inc-1", "exp-1.cxz");
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, "x");

    await deleteExportPackage("org-1", "inc-1", "exp-1");

    expect(mockDelete).toHaveBeenCalledWith("exports/org-1/inc-1/exp-1.cxz");
    await expect(fs.readFile(legacyPath)).rejects.toThrow();
  });
});
