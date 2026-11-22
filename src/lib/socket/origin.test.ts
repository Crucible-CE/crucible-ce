// @vitest-environment node
//
// Socket.io CSWSH guard: the Origin check runs in allowRequest, i.e. on EVERY
// engine.io request — the polling handshake and the WebSocket upgrade alike.
// Boots the real Socket.io server on an ephemeral port.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: vi.fn() } } }));

const ENV = { PUBLIC_URL: "https://crucible.example.com", NODE_ENV: "production" };

describe("isAllowedSocketOrigin", () => {
  it("allows configured origins, extras, and no-Origin clients; rejects others", async () => {
    const { isAllowedSocketOrigin } = await import("./server");
    const env = { ...ENV, SOCKET_EXTRA_ALLOWED_ORIGINS: "https://ops.example.com, junk" };
    expect(isAllowedSocketOrigin("https://crucible.example.com", "crucible.example.com", env)).toBe(true);
    expect(isAllowedSocketOrigin("https://ops.example.com", undefined, env)).toBe(true);
    expect(isAllowedSocketOrigin(undefined, undefined, env)).toBe(true);
    expect(isAllowedSocketOrigin("https://evil.example.com", "crucible.example.com", env)).toBe(false);
    expect(isAllowedSocketOrigin("null", undefined, env)).toBe(false);
    // Production never allows the dev localhost ports.
    expect(isAllowedSocketOrigin("http://localhost:3000", undefined, env)).toBe(false);
    expect(isAllowedSocketOrigin("http://localhost:3000", undefined, { NODE_ENV: "development", PUBLIC_URL: ENV.PUBLIC_URL })).toBe(true);
  });

  it("falls back to same-Host only when no public URL is configured", async () => {
    const { isAllowedSocketOrigin } = await import("./server");
    const env = { NODE_ENV: "production" };
    expect(isAllowedSocketOrigin("http://10.0.0.5:3000", "10.0.0.5:3000", env)).toBe(true);
    expect(isAllowedSocketOrigin("http://evil.test", "10.0.0.5:3000", env)).toBe(false);
  });
});

describe("Socket.io server enforces Origin on polling and upgrade", () => {
  let httpServer: Server;
  let port: number;
  let close: () => Promise<void>;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.PUBLIC_URL = ENV.PUBLIC_URL;
    delete process.env.AUTH_URL;
    delete process.env.NEXTAUTH_URL;
    delete process.env.REDIS_URL;
    delete process.env.SOCKET_TRANSPORTS;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initSocketServer } = await import("./server");
    httpServer = createServer();
    const io = await initSocketServer(httpServer);
    await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", () => r()));
    port = (httpServer.address() as AddressInfo).port;
    close = () => new Promise<void>((r) => io.close(() => r()));
  });

  afterAll(async () => {
    await close();
    process.env = saved;
    vi.restoreAllMocks();
  });

  const poll = (origin?: string) =>
    fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`, {
      headers: origin ? { Origin: origin } : {},
    });

  it("polling: allowed Origin is served, with nosniff", async () => {
    const res = await poll(ENV.PUBLIC_URL);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("polling: a foreign Origin is refused", async () => {
    const res = await poll("https://evil.example.com");
    expect(res.status).toBe(403);
  });

  it("polling: no Origin (non-browser) reaches the handshake", async () => {
    const res = await poll();
    expect(res.status).toBe(200);
  });

  it("websocket upgrade: a foreign Origin is refused", async () => {
    const outcome = await new Promise<string>((resolve) => {
      const req = request({
        host: "127.0.0.1",
        port,
        path: "/socket.io/?EIO=4&transport=websocket",
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          Origin: "https://evil.example.com",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
      });
      req.on("upgrade", (_res, socket) => {
        socket.destroy();
        resolve("upgraded");
      });
      req.on("response", (res) => resolve(`status:${res.statusCode}`));
      req.on("error", () => resolve("closed"));
      req.end();
    });
    expect(outcome).not.toBe("upgraded");
  });

  it("websocket upgrade: an allowed Origin upgrades", async () => {
    const outcome = await new Promise<string>((resolve) => {
      const req = request({
        host: "127.0.0.1",
        port,
        path: "/socket.io/?EIO=4&transport=websocket",
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          Origin: ENV.PUBLIC_URL,
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
      });
      req.on("upgrade", (_res, socket) => {
        socket.destroy();
        resolve("upgraded");
      });
      req.on("response", (res) => resolve(`status:${res.statusCode}`));
      req.on("error", () => resolve("closed"));
      req.end();
    });
    expect(outcome).toBe("upgraded");
  });
});
