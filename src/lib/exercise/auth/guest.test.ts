// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();
vi.mock("@/lib/db", () => ({ db: { guestSession: { findUnique: (...a: unknown[]) => findUnique(...a), create: (...a: unknown[]) => create(...a) } } }));
vi.mock("@/lib/exercise/auth/session", () => ({ getSessionUser: vi.fn().mockResolvedValue(null) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import {
  generateJoinCode,
  hashGuestToken,
  issueGuestSession,
  normalizeJoinCode,
  resolveGuest,
  resolvePrincipal,
  sanitizeDisplayName,
} from "./guest";
import { GUEST_COOKIE_PLAIN, GUEST_COOKIE_SECURE, guestCookieName, guestMayAccess, parseGuestCookieValue, readGuestCookie } from "./guest-cookie";
import { SETUP_CODE_ALPHABET } from "@/lib/setup/setup-code";

beforeEach(() => vi.clearAllMocks());

describe("join codes", () => {
  it("are 8 chars from the unambiguous alphabet and random", () => {
    const re = new RegExp(`^[${SETUP_CODE_ALPHABET}]{8}$`);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = generateJoinCode();
      expect(c).toMatch(re);
      seen.add(c);
    }
    expect(seen.size).toBe(500);
    expect(normalizeJoinCode(" abcd-efgh ")).toBe("ABCDEFGH");
  });
});

describe("sanitizeDisplayName", () => {
  it("strips control and invisible characters, collapses whitespace, trims", () => {
    expect(sanitizeDisplayName("  Ana\u0000 ‮maria\t\n Lopez ​")).toEqual({ ok: true, name: "Ana maria Lopez" });
  });

  it("enforces 40 characters", () => {
    expect(sanitizeDisplayName("a".repeat(40))).toEqual({ ok: true, name: "a".repeat(40) });
    expect(sanitizeDisplayName("a".repeat(41)).ok).toBe(false);
  });

  it("refuses empty and reserved names, case-insensitively", () => {
    for (const n of ["", "   ", "\u0000", 42, null]) expect(sanitizeDisplayName(n).ok).toBe(false);
    for (const n of ["Facilitator", "SYSTEM", "admin", " Controller ", "evaluator", "ａｄｍｉｎ"]) {
      expect(sanitizeDisplayName(n).ok).toBe(false);
    }
    expect(sanitizeDisplayName("Admin Team").ok).toBe(true);
  });
});

describe("guest cookie", () => {
  const token = "A".repeat(43);

  it("uses the __Host- name only when secure", () => {
    expect(guestCookieName({ PUBLIC_URL: "https://ttx.example.com" })).toBe(GUEST_COOKIE_SECURE);
    expect(guestCookieName({ PUBLIC_URL: "http://localhost:3100" })).toBe(GUEST_COOKIE_PLAIN);
    expect(guestCookieName({ NODE_ENV: "production" })).toBe(GUEST_COOKIE_SECURE);
  });

  it("parses exerciseId.token and rejects anything else", () => {
    expect(parseGuestCookieValue(`cex123456789.${token}`)).toEqual({ exerciseId: "cex123456789", token });
    for (const v of ["", "nodot", `.${token}`, "cex123456789.short", `cex/../x.${token}`, null]) {
      expect(parseGuestCookieValue(v)).toBeNull();
    }
  });

  it("reads either cookie name, preferring __Host-", () => {
    expect(readGuestCookie(`a=1; ${GUEST_COOKIE_PLAIN}=p; b=2`)).toBe("p");
    expect(readGuestCookie(`${GUEST_COOKIE_PLAIN}=p; ${GUEST_COOKIE_SECURE}=s`)).toBe("s");
    expect(readGuestCookie("a=1")).toBeNull();
  });

  it("guests may reach only their own play page and play API", () => {
    expect(guestMayAccess("/play/ex1", "ex1")).toBe(true);
    expect(guestMayAccess("/play/ex1/team", "ex1")).toBe(true);
    expect(guestMayAccess("/api/play/ex1/vote", "ex1")).toBe(true);
    expect(guestMayAccess("/play/ex2", "ex1")).toBe(false);
    expect(guestMayAccess("/play/ex10", "ex1")).toBe(false);
    expect(guestMayAccess("/api/play/ex2/vote", "ex1")).toBe(false);
    expect(guestMayAccess("/exercises", "ex1")).toBe(false);
    expect(guestMayAccess("/api/exercises/ex1", "ex1")).toBe(false);
  });
});

describe("guest sessions", () => {
  it("issue stores only the token hash and sets an httpOnly cookie on the response", async () => {
    create.mockResolvedValue({ id: "gs1" });
    const set = vi.fn();
    const response = { cookies: { set } } as unknown as import("next/server").NextResponse;
    const issued = await issueGuestSession("cexercise001", "cpart0001", { response, now: new Date("2026-01-01T00:00:00Z") });
    const stored = create.mock.calls[0][0].data;
    const [name, value, options] = set.mock.calls[0];
    const token = value.split(".")[1];
    expect(stored.tokenHash).toBe(hashGuestToken(token));
    expect(stored.tokenHash).not.toContain(token);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(name).toBe(guestCookieName());
    expect(value.startsWith("cexercise001.")).toBe(true);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(issued.expiresAt.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  const cookieReq = (value: string) => new Request("http://x/api/play/cexercise001", { headers: { cookie: `${GUEST_COOKIE_PLAIN}=${value}` } });
  const token = "B".repeat(43);
  const row = (over: Record<string, unknown> = {}) => ({
    exerciseId: "cexercise001",
    participantId: "cpart0001",
    expiresAt: new Date(Date.now() + 60_000),
    participant: { removedAt: null, isGuest: true, exerciseId: "cexercise001" },
    ...over,
  });

  it("resolves a valid cookie to its exercise and participant", async () => {
    findUnique.mockResolvedValue(row());
    expect(await resolveGuest(cookieReq(`cexercise001.${token}`))).toEqual({ exerciseId: "cexercise001", participantId: "cpart0001" });
    expect(findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashGuestToken(token) });
    expect(await resolvePrincipal(cookieReq(`cexercise001.${token}`))).toEqual({ kind: "guest", exerciseId: "cexercise001", participantId: "cpart0001" });
  });

  it("rejects expired, mismatched-exercise, removed and non-guest sessions", async () => {
    for (const r of [
      row({ expiresAt: new Date(Date.now() - 1) }),
      row({ exerciseId: "cotherex0001" }),
      row({ participant: { removedAt: new Date(), isGuest: true, exerciseId: "cexercise001" } }),
      row({ participant: { removedAt: null, isGuest: false, exerciseId: "cexercise001" } }),
      null,
    ]) {
      findUnique.mockResolvedValue(r);
      expect(await resolveGuest(cookieReq(`cexercise001.${token}`))).toBeNull();
    }
  });

  it("returns null (never throws) on a malformed cookie or a DB error", async () => {
    expect(await resolveGuest(cookieReq("garbage"))).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
    findUnique.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolveGuest(cookieReq(`cexercise001.${token}`))).toBeNull();
    expect(await resolvePrincipal(new Request("http://x/"))).toBeNull();
  });
});
