import { describe, it, expect } from "vitest";
import {
  KNOWN_DEVICE_COOKIE,
  KNOWN_DEVICE_MAX_AGE_SEC,
  readKnownDeviceCookie,
  signKnownDevice,
  verifyKnownDevice,
} from "./known-device";

const env = { AUTH_SECRET: "a".repeat(40) };
const NOW = 1_800_000_000;
const alice = { id: "user-1", passwordHash: "$2b$12$alice" };

describe("known-device cookie", () => {
  it("verifies only for the account it was issued to", () => {
    const v = signKnownDevice(alice, NOW, env)!;
    expect(verifyKnownDevice(v, alice, NOW + 10, env)).toBe(true);
    expect(verifyKnownDevice(v, { id: "user-2", passwordHash: "$2b$12$bob" }, NOW, env)).toBe(false);
    expect(verifyKnownDevice(v, null, NOW, env)).toBe(false);
  });

  it("is opaque: the user id is not in the value, and each issue is unique", () => {
    const a = signKnownDevice(alice, NOW, env)!;
    const b = signKnownDevice(alice, NOW, env)!;
    expect(a).not.toBe(b);
    expect(a).not.toContain("user-1");
    expect(a).not.toContain(Buffer.from("user-1").toString("base64url"));
  });

  it("a password change invalidates it", () => {
    const v = signKnownDevice(alice, NOW, env)!;
    expect(verifyKnownDevice(v, { ...alice, passwordHash: "$2b$12$changed" }, NOW, env)).toBe(false);
  });

  it("rejects tampering, another secret, expiry; malformed input never throws", () => {
    const v = signKnownDevice(alice, NOW, env)!;
    const [ver, id, , sig] = v.split(".");
    expect(verifyKnownDevice(`${ver}.${id}.${NOW + 1}.${sig}`, alice, NOW, env)).toBe(false);
    expect(verifyKnownDevice(v, alice, NOW, { AUTH_SECRET: "b".repeat(40) })).toBe(false);
    expect(verifyKnownDevice(v, alice, NOW + KNOWN_DEVICE_MAX_AGE_SEC + 1, env)).toBe(false);
    for (const junk of ["", "nope", "v1...", "v1.a.b.c.d", "%%%", "x".repeat(10_000), null, undefined]) {
      expect(verifyKnownDevice(junk, alice, NOW, env)).toBe(false);
    }
  });

  it("is disabled without a secret", () => {
    expect(signKnownDevice(alice, NOW, {})).toBeNull();
    expect(verifyKnownDevice("v1.a.1.b", alice, NOW, {})).toBe(false);
  });

  it("reads the cookie from the Cookie header", () => {
    const req = new Request("https://x/", { headers: { cookie: `a=1; ${KNOWN_DEVICE_COOKIE}=abc.def; b=2` } });
    expect(readKnownDeviceCookie(req)).toBe("abc.def");
    expect(readKnownDeviceCookie(new Request("https://x/"))).toBeNull();
  });
});
