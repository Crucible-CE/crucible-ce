// @vitest-environment node
// WebAuthn flows with the cryptographic verification mocked: what is under
// test is the challenge bookkeeping (stored, bound, single use), credential
// ownership and the signature-counter regression check.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chDeleteMany: vi.fn(),
  chCreate: vi.fn(),
  credFindMany: vi.fn(),
  credFindUnique: vi.fn(),
  credCreate: vi.fn(),
  credUpdateMany: vi.fn(),
  genReg: vi.fn(),
  verReg: vi.fn(),
  genAuth: vi.fn(),
  verAuth: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    webAuthnChallenge: { deleteMany: h.chDeleteMany, create: h.chCreate },
    webAuthnCredential: { findMany: h.credFindMany, findUnique: h.credFindUnique, create: h.credCreate, updateMany: h.credUpdateMany },
  },
}));
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: h.genReg,
  verifyRegistrationResponse: h.verReg,
  generateAuthenticationOptions: h.genAuth,
  verifyAuthenticationResponse: h.verAuth,
}));

import { authenticationOptions, challengeFromResponse, registrationOptions, verifyAuthentication, verifyRegistration } from "./webauthn";

const clientData = (challenge: string) => Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: "http://localhost:3200" })).toString("base64url");
const authResponse = (challenge = "CH1", id = "cred-1") => ({ id, rawId: id, type: "public-key", response: { clientDataJSON: clientData(challenge) }, clientExtensionResults: {} });
const regResponse = (challenge = "RG1") => ({ id: "cred-new", rawId: "cred-new", type: "public-key", response: { clientDataJSON: clientData(challenge), transports: ["usb"] }, clientExtensionResults: {} });
const storedCred = { id: "row-1", userId: "u1", credentialId: "cred-1", publicKey: new Uint8Array([1, 2, 3]), counter: BigInt(5), transports: ["usb"] };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PUBLIC_URL = "http://localhost:3200";
  h.chDeleteMany.mockResolvedValue({ count: 1 });
  h.credFindMany.mockResolvedValue([{ credentialId: "cred-1", transports: ["usb"] }]);
  h.credFindUnique.mockResolvedValue(storedCred);
  h.credUpdateMany.mockResolvedValue({ count: 1 });
});

describe("registration", () => {
  it("issues options for the configured RP and stores the challenge (5 min)", async () => {
    h.genReg.mockResolvedValue({ challenge: "RG1" });
    const r = await registrationOptions({ id: "u1", email: "ada@x.test", name: "Ada" });
    expect(r.ok).toBe(true);
    expect(h.genReg).toHaveBeenCalledWith(
      expect.objectContaining({ rpID: "localhost", userName: "ada@x.test", authenticatorSelection: expect.objectContaining({ userVerification: "preferred" }), excludeCredentials: [{ id: "cred-1", transports: ["usb"] }] }),
    );
    expect(h.chCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "u1", purpose: "register", challenge: "RG1", ticketId: null }) });
  });

  it("is unavailable without https (except localhost)", async () => {
    process.env.PUBLIC_URL = "http://crucible.lan";
    expect(await registrationOptions({ id: "u1", email: "a", name: null })).toMatchObject({ ok: false });
    expect(h.genReg).not.toHaveBeenCalled();
  });

  it("verifies against the stored challenge, consuming it, and saves the credential", async () => {
    h.verReg.mockResolvedValue({
      verified: true,
      registrationInfo: { aaguid: "aaguid-1", credential: { id: "cred-new", publicKey: new Uint8Array([9]), counter: 0, transports: ["usb"] }, credentialDeviceType: "singleDevice", credentialBackedUp: false },
    });
    h.credFindUnique.mockResolvedValue(null);
    h.credCreate.mockResolvedValue({ id: "row-2", name: "YubiKey", createdAt: new Date() });
    const r = await verifyRegistration("u1", regResponse() as never, "YubiKey");
    expect(r).toMatchObject({ ok: true, credential: { id: "row-2" } });
    expect(h.chDeleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ challenge: "RG1", userId: "u1", purpose: "register" }) });
    expect(h.verReg).toHaveBeenCalledWith(expect.objectContaining({ expectedChallenge: "RG1", expectedOrigin: "http://localhost:3200", expectedRPID: "localhost" }));
    expect(h.credCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "u1", name: "YubiKey", credentialId: "cred-new", counter: BigInt(0), aaguid: "aaguid-1" }) }));
  });

  it("a used or unknown challenge is refused before verification", async () => {
    h.chDeleteMany.mockResolvedValue({ count: 0 });
    expect(await verifyRegistration("u1", regResponse() as never, "x")).toMatchObject({ ok: false });
    expect(h.verReg).not.toHaveBeenCalled();
  });
});

describe("authentication", () => {
  it("binds a login challenge to the pending ticket", async () => {
    h.genAuth.mockResolvedValue({ challenge: "CH1" });
    await authenticationOptions("u1", "login", "tk1");
    expect(h.chCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ purpose: "login", challenge: "CH1", ticketId: "tk1" }) });
    expect(h.genAuth).toHaveBeenCalledWith(expect.objectContaining({ allowCredentials: [{ id: "cred-1", transports: ["usb"] }], userVerification: "preferred" }));
  });

  it("accepts an increased counter and stores it (conditional on the old one)", async () => {
    h.verAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 6 } });
    expect(await verifyAuthentication("u1", authResponse() as never, "login", "tk1")).toEqual({ ok: true, credentialId: "row-1" });
    expect(h.chDeleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ challenge: "CH1", purpose: "login", ticketId: "tk1" }) });
    expect(h.credUpdateMany).toHaveBeenCalledWith({ where: { id: "row-1", counter: BigInt(5) }, data: expect.objectContaining({ counter: BigInt(6) }) });
  });

  it("rejects a counter that did not increase (cloned authenticator)", async () => {
    h.verAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 5 } });
    expect(await verifyAuthentication("u1", authResponse() as never, "login", "tk1")).toEqual({ ok: false, reason: "counter" });
    h.verAuth.mockRejectedValue(new Error("Response counter value 3 was lower than expected 5"));
    expect(await verifyAuthentication("u1", authResponse() as never, "login", "tk1")).toEqual({ ok: false, reason: "counter" });
    expect(h.credUpdateMany).not.toHaveBeenCalled();
  });

  it("allows authenticators that never count (0 -> 0)", async () => {
    h.credFindUnique.mockResolvedValue({ ...storedCred, counter: BigInt(0) });
    h.verAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 0 } });
    expect(await verifyAuthentication("u1", authResponse() as never, "reauth")).toMatchObject({ ok: true });
  });

  it("a replayed assertion (challenge already used) and another user's key are refused", async () => {
    h.chDeleteMany.mockResolvedValueOnce({ count: 0 });
    expect(await verifyAuthentication("u1", authResponse() as never, "login", "tk1")).toEqual({ ok: false, reason: "challenge" });
    h.credFindUnique.mockResolvedValueOnce({ ...storedCred, userId: "u2" });
    expect(await verifyAuthentication("u1", authResponse() as never, "login", "tk1")).toEqual({ ok: false, reason: "unknown_credential" });
    expect(h.verAuth).not.toHaveBeenCalled();
  });

  it("challengeFromResponse reads clientDataJSON safely", () => {
    expect(challengeFromResponse(authResponse("abc") as never)).toBe("abc");
    expect(challengeFromResponse({ response: { clientDataJSON: "%%%" } })).toBeNull();
    expect(challengeFromResponse(null)).toBeNull();
  });
});
