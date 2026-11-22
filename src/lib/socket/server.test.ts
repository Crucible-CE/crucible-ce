import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetToken = vi.fn();

vi.mock("next-auth/jwt", () => ({
  getToken: mockGetToken,
}));

const mockUserFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) } },
}));

const activeUser = {
  isActive: true,
  organizationId: "org-1",
  role: "contributor",
  tokenVersion: 3,
  name: "Dana",
  organization: { requireMfa: false },
  mfa: null,
  _count: { webauthnCreds: 0 },
};

describe("socket server auth helpers", () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockUserFindUnique.mockReset();
    mockUserFindUnique.mockResolvedValue(activeUser);
  });

  it("resolveSocketAuthContext returns null when token is missing id", async () => {
    mockGetToken.mockResolvedValueOnce({ organizationId: "org-1" });
    const { resolveSocketAuthContext } = await import("./server");

    const socket = { request: { headers: {} } } as never;
    const result = await resolveSocketAuthContext(socket);

    expect(result).toBeNull();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("resolveSocketAuthContext revalidates against the DB in ONE select", async () => {
    mockGetToken.mockResolvedValueOnce({
      id: "user-1",
      organizationId: "org-1",
      role: "contributor",
      tokenVersion: 3,
    });

    const { resolveSocketAuthContext } = await import("./server");
    const socket = { request: { headers: {} } } as never;
    const result = await resolveSocketAuthContext(socket);

    expect(result).toEqual({
      userId: "user-1",
      organizationId: "org-1",
      role: "contributor",
      name: "Dana",
    });
    expect(mockUserFindUnique).toHaveBeenCalledTimes(1);
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: expect.objectContaining({ isActive: true, organizationId: true, role: true, tokenVersion: true, name: true, organization: expect.anything() }),
    });
  });

  it("refuses a member behind the sign-in wall (funnelled into MFA enrollment)", async () => {
    const { resolveSocketAuthContext } = await import("./server");
    const token = { id: "user-1", organizationId: "org-1", tokenVersion: 3 };
    // Org requires MFA, member has none: funnelled.
    mockGetToken.mockResolvedValueOnce(token);
    mockUserFindUnique.mockResolvedValueOnce({ ...activeUser, organization: { requireMfa: true } });
    expect(await resolveSocketAuthContext({ request: { headers: {} } } as never)).toBeNull();
    // Same policy, member enrolled: allowed.
    mockGetToken.mockResolvedValueOnce(token);
    mockUserFindUnique.mockResolvedValueOnce({ ...activeUser, organization: { requireMfa: true }, _count: { webauthnCreds: 1 } });
    expect(await resolveSocketAuthContext({ request: { headers: {} } } as never)).not.toBeNull();
    // A confirmed TOTP without a secret does not count.
    mockGetToken.mockResolvedValueOnce(token);
    mockUserFindUnique.mockResolvedValueOnce({ ...activeUser, organization: { requireMfa: true }, mfa: { totpEnabledAt: new Date(), totpSecretEnc: null } });
    expect(await resolveSocketAuthContext({ request: { headers: {} } } as never)).toBeNull();
  });

  it("rejects an inactive (deactivated) user", async () => {
    mockGetToken.mockResolvedValueOnce({ id: "user-1", organizationId: "org-1", tokenVersion: 3 });
    mockUserFindUnique.mockResolvedValueOnce({ ...activeUser, isActive: false });
    const { resolveSocketAuthContext } = await import("./server");
    expect(await resolveSocketAuthContext({ request: { headers: {} } } as never)).toBeNull();
  });

  it("rejects a deleted user", async () => {
    mockGetToken.mockResolvedValueOnce({ id: "user-1", organizationId: "org-1", tokenVersion: 3 });
    mockUserFindUnique.mockResolvedValueOnce(null);
    const { resolveSocketAuthContext } = await import("./server");
    expect(await resolveSocketAuthContext({ request: { headers: {} } } as never)).toBeNull();
  });

  it("rejects a stale tokenVersion (force-logout / password change)", async () => {
    mockGetToken.mockResolvedValueOnce({ id: "user-1", organizationId: "org-1", tokenVersion: 2 });
    const { resolveSocketAuthContext } = await import("./server");
    expect(await resolveSocketAuthContext({ request: { headers: {} } } as never)).toBeNull();
  });

  it("rejects a token whose organization no longer matches the user", async () => {
    mockGetToken.mockResolvedValueOnce({ id: "user-1", organizationId: "org-OLD", tokenVersion: 3 });
    const { resolveSocketAuthContext } = await import("./server");
    expect(await resolveSocketAuthContext({ request: { headers: {} } } as never)).toBeNull();
  });

  it("takes the role from the DB, not the JWT claim", async () => {
    // Token still claims administrator; the user was demoted.
    mockGetToken.mockResolvedValueOnce({
      id: "user-1",
      organizationId: "org-1",
      role: "administrator",
      tokenVersion: 3,
    });
    mockUserFindUnique.mockResolvedValueOnce({ ...activeUser, role: "reader" });
    const { resolveSocketAuthContext } = await import("./server");
    const result = await resolveSocketAuthContext({ request: { headers: {} } } as never);
    expect(result?.role).toBe("reader");
  });

});

describe("resolveSecureCookie (scheme-derived, never NODE_ENV)", () => {
  it("plain HTTP with no proxy header and an http AUTH_URL → insecure cookie", async () => {
    const { resolveSecureCookie } = await import("./server");
    expect(
      resolveSecureCookie({ headers: {}, encrypted: false, authUrl: "http://localhost:3000" }),
    ).toBe(false);
  });

  it("ignores NODE_ENV=production on plain HTTP", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { resolveSecureCookie } = await import("./server");
    expect(
      resolveSecureCookie({ headers: {}, encrypted: false, authUrl: "http://10.0.0.5:3000" }),
    ).toBe(false);
    vi.unstubAllEnvs();
  });

  it("x-forwarded-proto https → secure; http → insecure (wins over AUTH_URL)", async () => {
    const { resolveSecureCookie } = await import("./server");
    expect(
      resolveSecureCookie({ headers: { "x-forwarded-proto": "https" }, authUrl: "http://x" }),
    ).toBe(true);
    expect(
      resolveSecureCookie({ headers: { "x-forwarded-proto": "http" }, authUrl: "https://x" }),
    ).toBe(false);
    expect(
      resolveSecureCookie({ headers: { "x-forwarded-proto": "https, http" } }),
    ).toBe(true);
    expect(
      resolveSecureCookie({ headers: { "x-forwarded-proto": ["https"] } }),
    ).toBe(true);
  });

  it("a TLS connection → secure", async () => {
    const { resolveSecureCookie } = await import("./server");
    expect(resolveSecureCookie({ headers: {}, encrypted: true })).toBe(true);
  });

  it("falls back to AUTH_URL scheme when there is no proxy header", async () => {
    const { resolveSecureCookie } = await import("./server");
    expect(resolveSecureCookie({ headers: {}, authUrl: "https://crucible.example" })).toBe(true);
    expect(resolveSecureCookie({ headers: {} })).toBe(false);
  });

  it("follows the cookie the browser actually sent when only one name is present", async () => {
    const { resolveSecureCookie } = await import("./server");
    expect(
      resolveSecureCookie({
        headers: { "x-forwarded-proto": "https", cookie: "authjs.session-token=abc; other=1" },
      }),
    ).toBe(false);
    expect(
      resolveSecureCookie({
        headers: { cookie: "__Secure-authjs.session-token.0=abc; __Secure-authjs.session-token.1=d" },
        authUrl: "http://localhost:3000",
      }),
    ).toBe(true);
  });

  it("passes the derived secureCookie to getToken", async () => {
    mockGetToken.mockResolvedValueOnce({ id: "u1" });
    const { resolveSocketAuthContext } = await import("./server");
    vi.stubEnv("AUTH_URL", "http://localhost:3000");
    await resolveSocketAuthContext({ request: { headers: {} } } as never);
    expect(mockGetToken).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: false }));
    vi.unstubAllEnvs();
  });
});
