// @vitest-environment node
import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "crypto";
import { publicKeyFingerprint, signingKeyProblem } from "./signing";

const pem = (type: "ed25519" | "rsa") => {
  const { privateKey } =
    type === "rsa" ? generateKeyPairSync("rsa", { modulusLength: 1024 }) : generateKeyPairSync("ed25519");
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
};

describe("signingKeyProblem (boot warning)", () => {
  it("is quiet when the key is unset or a valid Ed25519 PEM (raw or base64)", () => {
    expect(signingKeyProblem({})).toBeNull();
    const k = pem("ed25519");
    expect(signingKeyProblem({ EXPORT_SIGNING_PRIVATE_KEY: k })).toBeNull();
    expect(signingKeyProblem({ EXPORT_SIGNING_PRIVATE_KEY: Buffer.from(k).toString("base64") })).toBeNull();
  });

  it("reports a malformed key", () => {
    expect(signingKeyProblem({ EXPORT_SIGNING_PRIVATE_KEY: "not-a-key" })).toMatch(/cannot be parsed/);
  });

  it("reports a non-Ed25519 key", () => {
    expect(signingKeyProblem({ EXPORT_SIGNING_PRIVATE_KEY: pem("rsa") })).toMatch(/Ed25519 key is required/);
  });
});

describe("publicKeyFingerprint", () => {
  it("is a stable 16-hex id per key", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const p = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(publicKeyFingerprint(p)).toMatch(/^[0-9a-f]{16}$/);
    expect(publicKeyFingerprint(p)).toBe(publicKeyFingerprint(p));
  });
});
