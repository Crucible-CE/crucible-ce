// @vitest-environment node
//
// The middleware matcher must let public/ static assets through without a
// session: the /_next/image optimizer fetches /cloud/*.png cookie-less, and an
// auth redirect there breaks every optimized image on the /cloud page.
// Also: the auth gate (JSON 401 for /api, redirect for pages), the CSRF Origin
// check, the page CSP and HSTS-only-over-HTTPS.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";

// The middleware module builds an edge NextAuth instance at import time; the
// mock makes `auth(handler)` return the handler itself so it can be driven
// directly with a request carrying `auth`.
vi.mock("next-auth", () => ({
  default: () => ({ auth: (handler: unknown) => handler }),
}));

import middleware, { config } from "./middleware";

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

type Handler = (req: NextRequest & { auth: unknown }) => Promise<Response>;
const run = (url: string, init: { method?: string; headers?: Record<string, string>; auth?: unknown } = {}) => {
  const req = new NextRequest(url, { method: init.method ?? "GET", headers: init.headers }) as NextRequest & { auth: unknown };
  req.auth = init.auth ?? null;
  return (middleware as unknown as Handler)(req);
};
const session = { user: { id: "u1" } };

describe("middleware matcher", () => {
  it("skips public/ static assets", () => {
    expect(matches("/cloud/war-room-dark.png")).toBe(false);
    expect(matches("/cloud/executive-dashboard.png")).toBe(false);
    expect(matches("/branding/logos/mark.svg")).toBe(false);
  });

  it("skips Next internals and icons", () => {
    expect(matches("/_next/static/chunks/main.js")).toBe(false);
    expect(matches("/_next/image?url=%2Fcloud%2Fwar-room-dark.png&w=1080&q=75")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
  });

  it("still gates the /cloud page and app pages", () => {
    expect(matches("/cloud")).toBe(true);
    expect(matches("/dashboard")).toBe(true);
    expect(matches("/incidents/abc")).toBe(true);
    expect(matches("/api/incidents")).toBe(true);
  });
});

describe("middleware behaviour", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.PUBLIC_URL = "https://crucible.example.com";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("anonymous /api/* gets a JSON 401, not a redirect", async () => {
    const res = await run("https://crucible.example.com/api/incidents");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    const unknown = await run("https://crucible.example.com/api/does-not-exist");
    expect(unknown.status).toBe(401);
  });

  it("anonymous pages still redirect to /login", async () => {
    const res = await run("https://crucible.example.com/dashboard");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?from=%2Fdashboard");
  });

  it("rejects a cross-origin state-changing API request with 403 (even signed in)", async () => {
    const res = await run("https://crucible.example.com/api/incidents", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
      auth: session,
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("csrf_origin_mismatch");
    expect(body.details).toBe(
      "Origin https://evil.example.com does not match PUBLIC_URL https://crucible.example.com; set PUBLIC_URL to the URL users open",
    );
  });

  it("lets same-origin writes and Twilio webhooks through", async () => {
    const ok = await run("https://crucible.example.com/api/incidents", {
      method: "POST",
      headers: { origin: "https://crucible.example.com" },
      auth: session,
    });
    expect(ok.headers.get("x-middleware-next")).toBe("1");
    const twilio = await run("https://crucible.example.com/api/public/twilio/inbound", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    });
    expect(twilio.headers.get("x-middleware-next")).toBe("1");
  });

  it("page CSP: no blanket wss:/https:, connect-src carries the PUBLIC_URL ws origin", async () => {
    const res = await run("https://crucible.example.com/login");
    const csp = res.headers.get("content-security-policy") ?? "";
    const connect = csp.split("; ").find((d) => d.startsWith("connect-src")) ?? "";
    expect(connect).toContain("'self'");
    expect(connect).toContain("wss://crucible.example.com");
    expect(connect.split(" ")).not.toContain("wss:");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("style-src 'self' 'unsafe-inline';");
    expect(csp).not.toMatch(/https:(\s|;|$)/);
  });

  it("HSTS only on HTTPS requests", async () => {
    const https = await run("https://crucible.example.com/login");
    expect(https.headers.get("strict-transport-security")).toMatch(/max-age=\d+/);
    const http = await run("http://10.0.0.5:3000/login");
    expect(http.headers.get("strict-transport-security")).toBeNull();
    const proxied = await run("http://app:3000/login", { headers: { "x-forwarded-proto": "https" } });
    expect(proxied.headers.get("strict-transport-security")).not.toBeNull();
  });
});

describe("middleware exercise guests", () => {
  const saved = { ...process.env };
  const exerciseId = "cexercise0000000000000001";
  const cookie = `ce-guest=${exerciseId}.${"a".repeat(43)}`;
  beforeEach(() => {
    process.env.PUBLIC_URL = "http://crucible.example.com";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("lets anyone open the join pages and the join API", async () => {
    expect((await run("http://crucible.example.com/join")).status).toBe(200);
    expect((await run("http://crucible.example.com/join/ABCD2345")).status).toBe(200);
    expect((await run("http://crucible.example.com/api/join/ABCD2345")).status).toBe(200);
  });

  it("lets anyone open incident guest and status pages, without leaking the token as a Referer", async () => {
    const t = "a".repeat(64);
    for (const path of [`/incident-guest/${t}`, `/status/${t}`]) {
      const res = await run(`http://crucible.example.com${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    }
    expect((await run(`http://crucible.example.com/api/public/incident-guest/${t}`)).status).toBe(200);
    expect((await run(`http://crucible.example.com/api/public/status/${t}`)).status).toBe(200);
    // Nothing else opens up: the incident pages and API still need a session.
    expect((await run("http://crucible.example.com/incidents/abc")).status).toBe(307);
    expect((await run("http://crucible.example.com/api/incidents/abc/guest-invites")).status).toBe(401);
    expect((await run("http://crucible.example.com/api/broadcasts")).status).toBe(401);
  });

  it("lets a guest reach only its own exercise play page and play API", async () => {
    expect((await run(`http://crucible.example.com/play/${exerciseId}`, { headers: { cookie } })).status).toBe(200);
    expect((await run(`http://crucible.example.com/api/play/${exerciseId}/state`, { headers: { cookie } })).status).toBe(200);
    expect((await run("http://crucible.example.com/play/cother000000000000000001", { headers: { cookie } })).status).toBe(307);
    expect((await run(`http://crucible.example.com/api/exercises/${exerciseId}`, { headers: { cookie } })).status).toBe(401);
    expect((await run("http://crucible.example.com/dashboard", { headers: { cookie } })).status).toBe(307);
  });
});
