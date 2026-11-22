import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { activeStorageBackend, __resetStorageForTests } from "./provider";

const ENV = ["STORAGE_S3_BUCKET", "STORAGE_DIR"];
const saved: Record<string, string | undefined> = {};

describe("storage provider factory", () => {
  beforeEach(() => {
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    __resetStorageForTests();
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    __resetStorageForTests();
  });

  it("defaults to filesystem with no env", () => {
    expect(activeStorageBackend()).toBe("filesystem");
  });

  it("selects s3 when the bucket is set", () => {
    process.env.STORAGE_S3_BUCKET = "b";
    expect(activeStorageBackend()).toBe("s3");
  });
});
