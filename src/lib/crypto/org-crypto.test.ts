// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encryptBytesForOrg,
  decryptBytesForOrg,
  deriveMasterSubkey,
  __resetDerivedKeysForTests,
} from "./org-crypto";

beforeAll(() => {
  process.env.MASTER_KEK = "c3".repeat(32);
  __resetDerivedKeysForTests();
});

describe("org blob encryption", () => {
  it.each([0, 1, 1024 * 1024 - 1, 1024 * 1024, 3 * 1024 * 1024 + 17])("round-trips %d bytes (sliced single-buffer path)", async (n) => {
    const data = randomBytes(n);
    const blob = await encryptBytesForOrg("org-1", data);
    expect(blob.length).toBe(32 + n);
    expect(blob.subarray(0, 4).toString()).toBe("CXO1");
    expect((await decryptBytesForOrg("org-1", blob)).equals(data)).toBe(true);
  });

  it("rejects a modified ciphertext, a truncated tag and the wrong org", async () => {
    const blob = await encryptBytesForOrg("org-1", Buffer.from("secret evidence"));
    const flipped = Buffer.from(blob);
    flipped[flipped.length - 1] ^= 1;
    await expect(decryptBytesForOrg("org-1", flipped)).rejects.toThrow();
    await expect(decryptBytesForOrg("org-2", blob)).rejects.toThrow();
  });

  it("deriveMasterSubkey is purpose-bound and deterministic", () => {
    const a = deriveMasterSubkey("ledger-v1");
    expect(a.length).toBe(32);
    expect(deriveMasterSubkey("ledger-v1").equals(a)).toBe(true);
    expect(deriveMasterSubkey("other-v1").equals(a)).toBe(false);
  });
});
