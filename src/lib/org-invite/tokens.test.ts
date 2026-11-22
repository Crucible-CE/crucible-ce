// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac, hkdfSync } from "node:crypto";
import { createOrgInviteToken, verifyOrgInviteToken, hashOrgInviteId, ORG_INVITE_HKDF_INFO } from "./tokens";

const SECRET = "s".repeat(48);
const saved = { AUTH_SECRET: process.env.AUTH_SECRET, NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET };

beforeEach(() => {
  delete process.env.AUTH_SECRET;
  process.env.NEXTAUTH_SECRET = SECRET;
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const params = { orgId: "org-1", orgSlug: "acme", role: "reader" };

describe("org invite tokens (HKDF-derived key)", () => {
  it("round-trips a fresh token", () => {
    const { token, idHash } = createOrgInviteToken(params);
    const v = verifyOrgInviteToken(token);
    expect(v.valid).toBe(true);
    if (v.valid) {
      expect(v.idHash).toBe(idHash);
      expect(v.idHash).toBe(hashOrgInviteId(token.split(".")[0]));
      expect(v.payload).toMatchObject({ orgId: "org-1", orgSlug: "acme", role: "reader" });
    }
  });

  it("signs with HKDF(secret, info crucible-invite-v1), NOT the raw secret", () => {
    const { token } = createOrgInviteToken(params);
    const [id, payload, sig] = token.split(".");
    const rawKeySig = createHmac("sha256", SECRET).update(`${id}.${payload}`).digest("base64url");
    expect(sig).not.toBe(rawKeySig);
    const k = Buffer.from(hkdfSync("sha256", SECRET, "crucible-ce", ORG_INVITE_HKDF_INFO, 32));
    expect(sig).toBe(createHmac("sha256", k).update(`${id}.${payload}`).digest("base64url"));
    expect(ORG_INVITE_HKDF_INFO).toBe("crucible-invite-v1");
  });

  it("rejects a token MACed with the raw secret (the pre-HKDF scheme)", () => {
    const { token } = createOrgInviteToken(params);
    const [id, payload] = token.split(".");
    const forged = `${id}.${payload}.${createHmac("sha256", SECRET).update(`${id}.${payload}`).digest("base64url")}`;
    expect(verifyOrgInviteToken(forged).valid).toBe(false);
  });

  it("rejects a tampered payload (role escalation)", () => {
    const { token } = createOrgInviteToken(params);
    const [id, payload, sig] = token.split(".");
    const p = JSON.parse(Buffer.from(payload, "base64url").toString());
    const evil = Buffer.from(JSON.stringify({ ...p, role: "administrator" })).toString("base64url");
    expect(verifyOrgInviteToken(`${id}.${evil}.${sig}`)).toMatchObject({ valid: false });
  });

  it("rejects after the secret rotates", () => {
    const { token } = createOrgInviteToken(params);
    process.env.NEXTAUTH_SECRET = "t".repeat(48);
    expect(verifyOrgInviteToken(token).valid).toBe(false);
  });

  it("rejects an expired token", () => {
    const { token } = createOrgInviteToken({ ...params, expiryDays: -1 });
    expect(verifyOrgInviteToken(token)).toMatchObject({ valid: false, error: expect.stringMatching(/expired/) });
  });

  it("rejects malformed tokens", () => {
    expect(verifyOrgInviteToken("abc").valid).toBe(false);
    expect(verifyOrgInviteToken("a.b.c").valid).toBe(false);
  });

  it("AUTH_SECRET takes precedence (same as ack tokens)", () => {
    process.env.AUTH_SECRET = "u".repeat(48);
    const { token } = createOrgInviteToken(params);
    delete process.env.AUTH_SECRET;
    expect(verifyOrgInviteToken(token).valid).toBe(false); // now keyed from NEXTAUTH_SECRET
  });

  it("throws when no secret is configured", () => {
    delete process.env.NEXTAUTH_SECRET;
    expect(() => createOrgInviteToken(params)).toThrow(/SECRET/);
  });
});
