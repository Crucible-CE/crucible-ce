import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const { mockEncrypt, mockDecrypt } = vi.hoisted(() => ({
  // Reversible fake "encryption" that still changes the bytes (magic prefix)
  // so round-trip tests can assert the stored bytes aren't plaintext.
  mockEncrypt: vi.fn(async (_org: string, buf: Buffer) => Buffer.concat([Buffer.from("CXO1"), buf])),
  mockDecrypt: vi.fn(async (_org: string, buf: Buffer) =>
    buf.subarray(0, 4).toString() === "CXO1" ? buf.subarray(4) : buf,
  ),
}));
vi.mock("@/lib/crypto/org-crypto", () => ({
  encryptBytesForOrg: mockEncrypt,
  decryptBytesForOrg: mockDecrypt,
}));

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
import { writeEvidence, readEvidence, deleteEvidence } from "./storage";

const ENV = ["STORAGE_S3_BUCKET", "EVIDENCE_DIR"];
const saved: Record<string, string | undefined> = {};
let tmpDir = "";

beforeEach(async () => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crucible-evidence-"));
  process.env.EVIDENCE_DIR = tmpDir;
  __resetStorageForTests();
  mockEncrypt.mockClear();
  mockDecrypt.mockClear();
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

describe("evidence storage — filesystem mode (no-op invariant)", () => {
  it("writes/reads/deletes on disk exactly as before, never touching the provider", async () => {
    const plaintext = Buffer.from("evidence bytes");
    await writeEvidence("org-1", "inc-1", "ev-1", plaintext);

    const onDisk = await fs.readFile(path.join(tmpDir, "org-1", "inc-1", "ev-1"));
    expect(onDisk.subarray(0, 4).toString()).toBe("CXO1");

    const back = await readEvidence("org-1", "inc-1", "ev-1");
    expect(back.equals(plaintext)).toBe(true);

    await deleteEvidence("org-1", "inc-1", "ev-1");
    await expect(fs.readFile(path.join(tmpDir, "org-1", "inc-1", "ev-1"))).rejects.toThrow();

    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("evidence storage — object-storage mode", () => {
  beforeEach(() => {
    process.env.STORAGE_S3_BUCKET = "test-bucket";
    __resetStorageForTests();
  });

  it("routes writes through the provider under evidence/{org}/{incident}/{evidence}", async () => {
    const plaintext = Buffer.from("evidence bytes");
    await writeEvidence("org-1", "inc-1", "ev-1", plaintext);

    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [key, bytes, contentType] = mockUpload.mock.calls[0];
    expect(key).toBe("evidence/org-1/inc-1/ev-1");
    expect(bytes.subarray(0, 4).toString()).toBe("CXO1");
    expect(contentType).toBe("application/octet-stream");
  });

  it("falls back to legacy disk on a provider not-found error", async () => {
    // Simulate a pre-cutover blob that only exists on legacy disk.
    const legacyCipher = Buffer.concat([Buffer.from("CXO1"), Buffer.from("legacy bytes")]);
    const legacyPath = path.join(tmpDir, "org-1", "inc-1", "ev-1");
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, legacyCipher);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const back = await readEvidence("org-1", "inc-1", "ev-1");
    expect(back.toString()).toBe("legacy bytes");
    expect(mockDownload).toHaveBeenCalledWith("evidence/org-1/inc-1/ev-1");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[evidence-storage] legacy-disk fallback hit"));
    warnSpy.mockRestore();
  });

  it("reads straight from the provider when present (no fallback log)", async () => {
    mockDownload.mockResolvedValueOnce(Buffer.concat([Buffer.from("CXO1"), Buffer.from("provider bytes")]));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const back = await readEvidence("org-1", "inc-1", "ev-1");
    expect(back.toString()).toBe("provider bytes");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("propagates non-not-found provider errors without falling back", async () => {
    mockDownload.mockRejectedValueOnce(new Error("boom"));
    await expect(readEvidence("org-1", "inc-1", "ev-1")).rejects.toThrow("boom");
  });

  it("deletes from both provider and legacy disk", async () => {
    const legacyPath = path.join(tmpDir, "org-1", "inc-1", "ev-1");
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, "x");

    await deleteEvidence("org-1", "inc-1", "ev-1");

    expect(mockDelete).toHaveBeenCalledWith("evidence/org-1/inc-1/ev-1");
    await expect(fs.readFile(legacyPath)).rejects.toThrow();
  });
});
