// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { publicKeyFingerprint } from "@/lib/export/signing";
import { ensureSigningKey, keyIdFor, loadSigningKey, readSigningKey } from "./keys";

const saved = { ...process.env };

beforeEach(() => {
  delete process.env.EXPORT_SIGNING_PRIVATE_KEY;
});
afterEach(() => {
  process.env = { ...saved };
});

function fakeClient() {
  const rows: { keyId: string; publicKeyPem: string }[] = [];
  return {
    rows,
    signingKey: {
      upsert: async ({ create }: { create: { keyId: string; publicKeyPem: string } }) => {
        if (!rows.some((r) => r.keyId === create.keyId)) rows.push(create);
        return create;
      },
    },
  };
}

function newPem(): string {
  return generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

describe("report signing key", () => {
  it("is off without EXPORT_SIGNING_PRIVATE_KEY", async () => {
    expect(readSigningKey()).toBeNull();
    expect(() => loadSigningKey()).toThrow(/EXPORT_SIGNING_PRIVATE_KEY/);
    expect(await ensureSigningKey(fakeClient() as never)).toBeNull();
  });

  it("registers the public key once and signs verifiably", async () => {
    process.env.EXPORT_SIGNING_PRIVATE_KEY = newPem();
    const client = fakeClient();
    const first = await ensureSigningKey(client as never);
    expect(first?.keyId).toMatch(/^[0-9a-f]{16}$/);
    await ensureSigningKey(client as never);
    expect(client.rows).toHaveLength(1);
    const { keyId, privateKey } = loadSigningKey();
    expect(keyId).toBe(first?.keyId);
    const msg = Buffer.from("canonical aar");
    expect(verify(null, msg, createPublicKey(client.rows[0].publicKeyPem), sign(null, msg, privateKey))).toBe(true);
  });

  it("uses the case-file export key and its fingerprint", () => {
    const pem = newPem();
    process.env.EXPORT_SIGNING_PRIVATE_KEY = Buffer.from(pem).toString("base64");
    const k = readSigningKey();
    expect(k?.keyId).toBe(publicKeyFingerprint(k!.publicKeyPem));
    process.env.EXPORT_SIGNING_PRIVATE_KEY = pem;
    expect(readSigningKey()?.keyId).toBe(k?.keyId);
  });

  it("keyId is the sha256 of the SPKI DER, first 16 hex", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const a = keyIdFor(publicKey);
    expect(a).toHaveLength(16);
    expect(keyIdFor(createPublicKey(publicKey.export({ type: "spki", format: "pem" })))).toBe(a);
  });

  it("refuses a non-Ed25519 key", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    process.env.EXPORT_SIGNING_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => loadSigningKey()).toThrow(/Ed25519/);
  });
});
