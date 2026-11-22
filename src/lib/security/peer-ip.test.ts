// @vitest-environment node
//
// Integration: the custom server's peer-IP stamping (server.ts ->
// createPeerIpStamper) feeding getClientIp at TRUSTED_PROXY_HOPS=0. Real HTTP
// over loopback; the handler converts the Node request headers to a Fetch
// Headers object the way Next does before route handlers see them.
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPeerIpStamper } from "./peer-ip";
import { getClientIp } from "./client-ip";

function toHeaders(h: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    out.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  return out;
}

describe("peer-IP stamping -> getClientIp (TRUSTED_PROXY_HOPS=0)", () => {
  const warn = vi.fn();
  const savedHeader = process.env.CRUCIBLE_PEER_IP_HEADER;
  const stamper = createPeerIpStamper({ trustedProxyHops: 0, warn });
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      stamper.stamp(req);
      const ip = getClientIp({ headers: toHeaders(req.headers) }, "lenient", 0);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ip, stamped: req.headers[stamper.headerName] ?? null }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    process.env.CRUCIBLE_PEER_IP_HEADER = savedHeader;
  });

  const get = (headers: Record<string, string> = {}) =>
    new Promise<{ ip: string | null; stamped: string | null }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/", headers }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(JSON.parse(body)));
      });
      req.on("error", reject);
      req.end();
    });

  it("publishes a random, well-formed header name", () => {
    expect(stamper.headerName).toMatch(/^x-crucible-peer-[0-9a-f]{24}$/);
    expect(process.env.CRUCIBLE_PEER_IP_HEADER).toBe(stamper.headerName);
    expect(createPeerIpStamper({ trustedProxyHops: 0, env: {} as NodeJS.ProcessEnv }).headerName).not.toBe(stamper.headerName);
    process.env.CRUCIBLE_PEER_IP_HEADER = stamper.headerName;
  });

  it("getClientIp returns the real TCP peer", async () => {
    const r = await get();
    expect(r.ip).toBe("127.0.0.1");
  });

  it("ignores X-Forwarded-For and X-Real-IP at hops=0, and warns once about the proxy setup", async () => {
    const a = await get({ "X-Forwarded-For": "6.6.6.6", "X-Real-IP": "7.7.7.7" });
    expect(a.ip).toBe("127.0.0.1");
    await get({ "X-Forwarded-For": "6.6.6.6" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/TRUSTED_PROXY_HOPS=1/);
  });

  it("a client-supplied peer header (guessed or even the real name) is overwritten", async () => {
    const guessed = "x-crucible-peer-000000000000000000000000";
    const r1 = await get({ [guessed]: "6.6.6.6" });
    expect(r1.ip).toBe("127.0.0.1");
    const r2 = await get({ [stamper.headerName]: "6.6.6.6" });
    expect(r2.ip).toBe("127.0.0.1");
    expect(r2.stamped).toBe("127.0.0.1");
  });

  it("without the stamp (plain next start) nothing is trusted at hops=0", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6", "x-crucible-peer-000000000000000000000000": "6.6.6.6" });
    expect(getClientIp({ headers: h }, "lenient", 0)).toBeNull();
  });
});
