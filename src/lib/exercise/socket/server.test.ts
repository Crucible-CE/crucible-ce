// @vitest-environment node
// The /ex namespace on CE's Socket.io server: Origin guard, and a real
// handshake / join / emit / evict round trip on an ephemeral port, for a
// signed-in user and for an invite-code guest.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

const getToken = vi.fn();
vi.mock("next-auth/jwt", () => ({ getToken: (...a: unknown[]) => getToken(...a) }));
const userFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: (...a: unknown[]) => userFindUnique(...a) } } }));
const resolveGuestCookieValue = vi.fn();
vi.mock("@/lib/exercise/auth/guest-core", () => ({ resolveGuestCookieValue: (...a: unknown[]) => resolveGuestCookieValue(...a) }));

const ENV = { PUBLIC_URL: "https://ce.example.com", NODE_ENV: "production" };

/** A CE user row as resolveSocketAuthContext selects it. */
function userRow(over: Record<string, unknown> = {}) {
  return {
    isActive: true,
    organizationId: "org-1",
    role: "contributor",
    tokenVersion: 2,
    name: "A",
    organization: { requireMfa: false },
    mfa: null,
    _count: { webauthnCreds: 0 },
    ...over,
  };
}

describe("Socket.io /ex namespace (live)", () => {
  let httpServer: Server;
  let port: number;
  let close: () => Promise<void>;
  const saved = { ...process.env };
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    process.env.PUBLIC_URL = ENV.PUBLIC_URL;
    process.env.AUTH_SECRET = "s".repeat(40);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initSocketServer } = await import("@/lib/socket/server");
    httpServer = createServer();
    const io = await initSocketServer(httpServer);
    await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", () => r()));
    port = (httpServer.address() as AddressInfo).port;
    close = async () => {
      await new Promise<void>((r) => io.close(() => r()));
      const { registerIO } = await import("./evict");
      registerIO(null);
      delete (globalThis as { __crucibleCe_io?: unknown }).__crucibleCe_io;
    };
  });

  afterAll(async () => {
    for (const c of clients) c.disconnect();
    await close();
    process.env = saved;
    vi.restoreAllMocks();
  });

  const poll = (origin?: string) =>
    fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`, { headers: origin ? { Origin: origin } : {} });

  it("polling: allowed Origin is served with nosniff; a foreign Origin is refused", async () => {
    const ok = await poll(ENV.PUBLIC_URL);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await poll("https://evil.example.com")).status).toBe(403);
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

  function connect(): Promise<{ socket: ClientSocket; error?: Error }> {
    return new Promise((resolve) => {
      const socket = ioClient(`http://127.0.0.1:${port}/ex`, {
        transports: ["websocket"],
        extraHeaders: { Origin: ENV.PUBLIC_URL, cookie: "authjs.session-token=fake" },
        reconnection: false,
        forceNew: true,
      });
      clients.push(socket);
      socket.on("connect", () => resolve({ socket }));
      socket.on("connect_error", (error) => resolve({ socket, error }));
    });
  }

  it("refuses a handshake with no session and no guest cookie", async () => {
    getToken.mockResolvedValue(null);
    resolveGuestCookieValue.mockResolvedValue(null);
    const { error } = await connect();
    expect(error?.message).toBe("Unauthorized");
  });

  it("refuses a user whose tokenVersion was bumped", async () => {
    getToken.mockResolvedValue({ id: "u1", tokenVersion: 1, organizationId: "org-1" });
    userFindUnique.mockResolvedValue(userRow({ tokenVersion: 2 }));
    const { error } = await connect();
    expect(error?.message).toBe("Unauthorized");
  });

  it("refuses a member who still owes two-factor setup", async () => {
    getToken.mockResolvedValue({ id: "u1", tokenVersion: 2, organizationId: "org-1" });
    userFindUnique.mockResolvedValue(userRow({ organization: { requireMfa: true } }));
    const { error } = await connect();
    expect(error?.message).toBe("Unauthorized");
  });

  it("a valid user connects, is denied by default, joins once authorized, and receives emits", async () => {
    getToken.mockResolvedValue({ id: "u1", tokenVersion: 2, organizationId: "org-1" });
    userFindUnique.mockResolvedValue(userRow());
    const { socket, error } = await connect();
    expect(error).toBeUndefined();

    const join = () =>
      new Promise<{ ok: boolean; rooms?: string[] }>((resolve) => socket.emit("join_exercise", { exerciseId: "ex1" }, resolve));
    expect(await join()).toEqual({ ok: false });

    const { setRoomAuthorizer, emitToExercise, SOCKET_EVENTS } = await import("./emit");
    setRoomAuthorizer(async (p, id) => (p.kind === "user" && id === "ex1" ? { all: true, teamIds: ["t1"] } : null));
    const joined = await join();
    expect(joined.ok).toBe(true);
    expect(joined.rooms).toEqual(["ex:ex1:all", "ex:ex1:team:t1"]);

    const got = new Promise<unknown>((resolve) => socket.on(SOCKET_EVENTS.EXERCISE_CHANGED, resolve));
    const notMine = vi.fn();
    socket.on("control-only", notMine);
    emitToExercise("ex1", "control", "control-only", { secret: true });
    emitToExercise("ex1", { teamId: "t2" }, "control-only", { secret: true });
    emitToExercise("ex1", "all", SOCKET_EVENTS.EXERCISE_CHANGED, { exerciseId: "ex1", stateVersion: 3 });
    expect(await got).toEqual({ exerciseId: "ex1", stateVersion: 3 });
    await new Promise((r) => setTimeout(r, 50));
    expect(notMine).not.toHaveBeenCalled();
    setRoomAuthorizer(null);
  });

  it("a guest connects with its cookie and can never join another exercise or the control room", async () => {
    getToken.mockResolvedValue(null);
    resolveGuestCookieValue.mockResolvedValue({ exerciseId: "ex1", participantId: "p9" });
    const { socket, error } = await connect();
    expect(error).toBeUndefined();
    const { setRoomAuthorizer, disconnectParticipant } = await import("./emit");
    setRoomAuthorizer(async () => ({ all: true, control: true }));
    const join = (exerciseId: string) =>
      new Promise<{ ok: boolean; rooms?: string[] }>((resolve) => socket.emit("join_exercise", { exerciseId }, resolve));
    expect(await join("ex2")).toEqual({ ok: false });
    expect((await join("ex1")).rooms).toEqual(["ex:ex1:all"]);

    const gone = new Promise<string>((resolve) => socket.on("disconnect", resolve));
    disconnectParticipant("p9");
    expect(await gone).toBe("io server disconnect");
    setRoomAuthorizer(null);
  });
});
