// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { canonicalize, CanonicalizeError } from "./canonical";
import { signDocument, verifyEnvelope } from "./sign";

describe("canonicalize (RFC 8785)", () => {
  it("sorts keys and drops undefined", () => {
    expect(canonicalize({ b: 1, a: [true, null, "x"], c: undefined })).toBe('{"a":[true,null,"x"],"b":1}');
  });
  it("uses shortest number form", () => {
    expect(canonicalize({ n: 1.0, m: 1e21, k: 0.000001 })).toBe('{"k":0.000001,"m":1e+21,"n":1}');
  });
  it("serializes dates as ISO strings", () => {
    expect(canonicalize({ d: new Date("2026-03-07T02:10:00Z") })).toBe('{"d":"2026-03-07T02:10:00.000Z"}');
  });
  it("rejects non-finite numbers", () => {
    expect(() => canonicalize({ n: Number.NaN })).toThrow(CanonicalizeError);
  });
  it("is independent of key insertion order", () => {
    expect(canonicalize({ x: { b: 2, a: 1 } })).toBe(canonicalize({ x: { a: 1, b: 2 } }));
  });
});

describe("sign and verify", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const key = { keyId: "k1", privateKey };

  it("verifies an untouched envelope", () => {
    const env = signDocument({ title: "AAR", items: [{ afi: "Notify sooner" }] }, key);
    expect(verifyEnvelope(env, pem)).toEqual({ ok: true });
  });
  it("fails after any change to the document", () => {
    const env = signDocument({ title: "AAR", items: [{ afi: "Notify sooner" }] }, key);
    const tampered = { ...env, document: { title: "AAR", items: [{ afi: "Notify later" }] } };
    expect(verifyEnvelope(tampered, pem).ok).toBe(false);
  });
  it("fails when signedAt changes", () => {
    const env = signDocument({ a: 1 }, key);
    expect(verifyEnvelope({ ...env, signedAt: "2020-01-01T00:00:00.000Z" }, pem).ok).toBe(false);
  });
  it("fails with another key", () => {
    const env = signDocument({ a: 1 }, key);
    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(verifyEnvelope(env, other).ok).toBe(false);
  });
});
