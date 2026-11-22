import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { getKms, assertKmsProviderConfigured, __resetKmsForTests } from "./kms";

const priorProvider = process.env.KMS_PROVIDER;
const priorKek = process.env.MASTER_KEK;

describe("KMS (MASTER_KEK only)", () => {
  beforeEach(() => {
    __resetKmsForTests();
    delete process.env.KMS_PROVIDER;
  });
  afterEach(() => {
    __resetKmsForTests();
    if (priorProvider === undefined) delete process.env.KMS_PROVIDER;
    else process.env.KMS_PROVIDER = priorProvider;
    if (priorKek === undefined) delete process.env.MASTER_KEK;
    else process.env.MASTER_KEK = priorKek;
  });

  it("getKms resolves without the KEK secret (loaded lazily)", () => {
    delete process.env.MASTER_KEK;
    expect(() => getKms()).not.toThrow();
  });

  it("wraps and unwraps a DEK with MASTER_KEK", () => {
    process.env.MASTER_KEK = randomBytes(32).toString("hex");
    const dek = randomBytes(32);
    const kms = getKms();
    expect(kms.unwrapDek(kms.wrapDek(dek)).equals(dek)).toBe(true);
    expect(kms.kekId()).toMatch(/^kek_[0-9a-f]{16}$/);
  });

  it("assertKmsProviderConfigured: unset or env boots, no KEK needed", () => {
    delete process.env.MASTER_KEK;
    expect(() => assertKmsProviderConfigured()).not.toThrow();
    process.env.KMS_PROVIDER = " ENV ";
    expect(() => assertKmsProviderConfigured()).not.toThrow();
  });

  it("assertKmsProviderConfigured: any cloud provider refuses to boot (never a silent fallback)", () => {
    for (const p of ["aws", "GCP", "azure", "garbage"]) {
      process.env.KMS_PROVIDER = p;
      expect(() => assertKmsProviderConfigured()).toThrow(/KMS_PROVIDER/);
    }
  });
});
